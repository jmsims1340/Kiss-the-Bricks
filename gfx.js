// Kiss the Bricks — sky, image-based lighting, post-processing and the quality governor.
import * as THREE from './three.module.min.js';

// ---------- sky: gradient + sun + perspective clouds (cloud texture baked once on the CPU) ----------
function cloudCanvas(size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  const img = g.createImageData(size, size), N = 64, grid = [];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < N * N; i++) grid.push(rnd());
  const val = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi; const a = (i, j) => grid[((j % N + N) % N) * N + ((i % N + N) % N)];
    const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf); return (a(xi, yi) * (1 - sx) + a(xi + 1, yi) * sx) * (1 - sy) + (a(xi, yi + 1) * (1 - sx) + a(xi + 1, yi + 1) * sx) * sy; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let f = 0, amp = 0.5, fr = 4 / size * 4; // tile-able: frequencies divide N
    for (let o = 0; o < 5; o++) { f += val(x * fr * (N / 16), y * fr * (N / 16)) * amp; amp *= 0.5; fr *= 2; }
    const k = (y * size + x) * 4, v = Math.max(0, Math.min(1, (f - 0.48) * 2.6));
    img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.round(v * 255); img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t;
}
export function makeSky(opt) {
  const u = {
    uSun: { value: opt.sunDir.clone().normalize() }, uZen: { value: new THREE.Color(opt.zenith) }, uHor: { value: new THREE.Color(opt.horizon) },
    uGround: { value: new THREE.Color(opt.ground) }, uClouds: { value: cloudCanvas() }, uCloudAmt: { value: opt.clouds }, uTime: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, depthWrite: false, depthTest: true, side: THREE.BackSide, fog: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = vec4(p.xy, p.w * 0.99999, p.w); }',
    fragmentShader: `uniform vec3 uSun, uZen, uHor, uGround; uniform sampler2D uClouds; uniform float uCloudAmt, uTime; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir); float h = d.y;
        vec3 col = mix(uHor, uZen, pow(clamp(h, 0.0, 1.0), 0.5));
        col = mix(col, uGround, smoothstep(0.0, -0.06, h));
        float sd = max(dot(d, uSun), 0.0);
        col += vec3(1.0, 0.82, 0.55) * pow(sd, 6.0) * 0.22 + vec3(1.0, 0.9, 0.75) * pow(sd, 64.0) * 0.5;
        if (h > 0.0) {
          vec2 cuv = d.xz / (h + 0.06) * 0.11 + vec2(uTime * 0.002, 0.0);
          float c = texture2D(uClouds, cuv).r * 0.75 + texture2D(uClouds, cuv * 2.7 + 0.31).r * 0.35;
          c = smoothstep(0.25, 0.95, c) * uCloudAmt * smoothstep(0.0, 0.18, h);
          vec3 cc = mix(vec3(0.78, 0.8, 0.85), vec3(1.08, 1.06, 1.02), smoothstep(0.2, 0.9, c)) + vec3(0.25, 0.2, 0.12) * pow(sd, 8.0);
          col = mix(col, cc, c * 0.85);
        }
        col += vec3(1.6, 1.45, 1.2) * smoothstep(0.9993, 0.9997, sd);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  mesh.scale.setScalar(3000); mesh.frustumCulled = false; mesh.renderOrder = -10; mesh.matrixAutoUpdate = true;
  return { mesh, uniforms: u, mat };
}
// prefiltered environment for reflections: the same sky plus a dark ground and a band of grandstands
export function makeEnvironment(renderer, sky, opt) {
  const pm = new THREE.PMREMGenerator(renderer);
  const es = new THREE.Scene();
  const s2 = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), sky.mat); s2.scale.setScalar(50); es.add(s2);
  const gnd = new THREE.Mesh(new THREE.CircleGeometry(48, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: opt.groundEnv || 0x3a3b3d })); gnd.position.y = -1.5; es.add(gnd);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(40, 40, 8, 48, 1, true), new THREE.MeshBasicMaterial({ color: 0x55585e, side: THREE.BackSide })); band.position.y = 2; es.add(band);
  const rt = pm.fromScene(es, 0.02, 0.1, 200);
  pm.dispose(); s2.geometry.dispose(); gnd.geometry.dispose(); band.geometry.dispose();
  return rt;
}

// ---------- post: MSAA HDR target -> speed blur, heat shimmer, vignette, tone map ----------
export function makePost(renderer) {
  const gl = renderer.getContext();
  const isGL2 = renderer.capabilities.isWebGL2;
  const ext = isGL2 && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
  if (!isGL2 || !ext) return null;
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true });
  const uni = { tDiffuse: { value: rt.texture }, uBlur: { value: 0 }, uTime: { value: 0 }, uShim: { value: 0 }, uVig: { value: 0.32 }, uCenter: { value: new THREE.Vector2(0.5, 0.55) }, uAspect: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: uni, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uBlur, uTime, uShim, uVig, uAspect; uniform vec2 uCenter; varying vec2 vUv;
      void main(){
        vec2 uv = vUv;
        float band = exp(-pow((uv.y - uCenter.y) * 7.0, 2.0)) * uShim * (1.0 - smoothstep(0.1, 0.45, abs(uv.x - 0.5)));
        uv.x += (sin(uv.y * 260.0 + uTime * 17.0) * 0.6 + sin(uv.y * 113.0 - uTime * 11.0) * 0.4) * 0.0016 * band;
        uv.y += sin(uv.x * 180.0 + uTime * 13.0) * 0.0007 * band;
        vec2 dir = uv - uCenter; float r = length(dir * vec2(uAspect, 1.0));
        vec4 c = texture2D(tDiffuse, uv);
        float k = uBlur * smoothstep(0.18, 0.75, r);
        if (k > 0.002) {
          vec4 acc = c;
          for (int i = 1; i < 6; i++) acc += texture2D(tDiffuse, uv - dir * k * float(i) * 0.016);
          c = acc / 6.0;
        }
        vec2 q = (vUv - 0.5) * vec2(1.0, 1.0);
        c.rgb *= 1.0 - uVig * smoothstep(0.35, 0.95, length(q) * 1.35);
        gl_FragColor = vec4(c.rgb, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false;
  const ps = new THREE.Scene(); ps.add(quad); const pc = new THREE.Camera();
  return {
    uni, rt,
    setSize(w, h, dpr) { rt.setSize(Math.max(4, Math.round(w * dpr)), Math.max(4, Math.round(h * dpr))); uni.uAspect.value = w / Math.max(1, h); },
    render(scene, camera) { renderer.setRenderTarget(rt); renderer.render(scene, camera); renderer.setRenderTarget(null); renderer.render(ps, pc); },
    dispose() { rt.dispose(); mat.dispose(); },
  };
}

// ---------- procedural surface textures ----------
export function noiseCanvas(w, h, base, amp, seed = 3) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = base; g.fillRect(0, 0, w, h);
  const id = g.getImageData(0, 0, w, h); let s = seed; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < id.data.length; i += 4) { const n = (r() - 0.5) * amp; id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n; }
  g.putImageData(id, 0, 0); return c;
}
