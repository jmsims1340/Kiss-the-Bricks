// Kiss the Bricks — haptics on big moments.
// Android / Chrome: navigator.vibrate. iPhone Safari has no vibrate API; on iOS 18+ toggling a hidden
// <input type="checkbox" switch> through its <label> plays the system's light haptic tick. iOS only allows it
// while a tap is being handled, so a moment that happens mid-race also fires on the player's next touch
// (within a fraction of a second) and on the pedal / menu taps themselves. Everything fails silently.
let enabled = true, label = null, pending = null, lastFire = 0;
const PAT = { tap: 8, wall: 35, crash: [40, 50, 60], lead: [20, 40, 20], best: [15, 30, 15, 30, 25], finish: [30, 60, 30, 60, 80], win: [40, 50, 40, 50, 120] };
const TAPS = { tap: 1, wall: 1, crash: 2, lead: 2, best: 2, finish: 3, win: 3 };
const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
function ensureSwitch() {
  if (label || canVibrate || typeof document === 'undefined') return;
  try {
    label = document.createElement('label'); label.setAttribute('aria-hidden', 'true');
    label.style.cssText = 'position:fixed;left:-200px;top:0;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none';
    const inp = document.createElement('input'); inp.type = 'checkbox'; inp.setAttribute('switch', ''); inp.tabIndex = -1;
    label.appendChild(inp); document.body.appendChild(label);
  } catch (e) { label = null; }
}
function tick(n) {
  if (!label) return;
  try { label.click(); } catch (e) {}
  for (let i = 1; i < n; i++) setTimeout(() => { try { label.click(); } catch (e) {} }, i * 90);
}
export function setHaptics(on) { enabled = !!on; if (enabled) ensureSwitch(); }
export function buzz(kind = 'tap') {
  if (!enabled) return;
  const now = performance.now();
  if (kind !== 'tap' && now - lastFire < 120) return; lastFire = now;
  if (canVibrate) { try { navigator.vibrate(PAT[kind] || 20); } catch (e) {} return; }
  ensureSwitch(); tick(TAPS[kind] || 1);
  // also replay it on the next touch, in case iOS ignored a tick that didn't come from a tap
  if (kind !== 'tap') pending = { kind, t: now };
}
// call from inside pointerdown / pointerup / touchend handlers
export function onUserGesture() {
  if (!enabled || !pending) return;
  const p = pending; pending = null;
  if (performance.now() - p.t < 450 && !canVibrate) tick(Math.min(2, TAPS[p.kind] || 1));
}
export const hapticsInfo = () => ({ vibrate: canVibrate, iosSwitch: !!label, enabled });
