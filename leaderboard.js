/* Game Day Garage arcade leaderboard: top 10 per board, 3-letter initials. Shared by Pin Seeker,
   Kiss the Bricks and Pocket Presence. Self-contained (injects its own CSS). If the leaderboard can't be
   reached, nothing breaks: afterRound() quietly resolves false and the game carries on. */
(function () {
  'use strict';
  var API = 'https://gamedaygarage.sites.tab.bot/api';
  var BLOCK = ('ASS ASZ AZZ FUK FUC FUQ FUX FCK FKU FKN FAG FGT CUM CUN CNT KKK DIK DIC DIX DYK COK COC KOK JIZ JIS NIG NGR NGA NGG NIP TIT TTS SEX SXY XXX PUS PSY VAG WTF POO PEE SHT SHI HOE WHR SLT TWT NAZ KYS SUK SUC HOR GAY ANL ANS BUM BJS PIS PSS PRN POR RAP FAP DMN JEW WOP SPC SPK GOK KUM FUG DCK PNS MFR MOF STF').split(' ');
  var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var C = { game: '', title: 'LEADERBOARD', boards: { main: 'Top 10' }, order: 'asc', fmt: function (s) { return String(s); }, unit: '', accent: '#f2c230' };
  var root = null, cache = {}, busy = false;

  var CSS = '' +
  '.gdglb{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:max(12px,env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) max(12px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left));background:rgba(4,8,16,.74);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#fff;-webkit-user-select:none;user-select:none;touch-action:manipulation;-webkit-tap-highlight-color:transparent;animation:gdglbIn .18s ease-out}' +
  '@keyframes gdglbIn{from{opacity:0}to{opacity:1}}' +
  '.gdglb *{box-sizing:border-box}' +
  '.gdglb-p{position:relative;width:100%;max-width:400px;max-height:100%;overflow:auto;-webkit-overflow-scrolling:touch;background:linear-gradient(180deg,#141c2e,#0a0f1a);border:2px solid var(--a);border-radius:18px;box-shadow:0 0 0 1px rgba(0,0,0,.6),0 0 28px color-mix(in srgb,var(--a) 45%,transparent),0 18px 50px rgba(0,0,0,.6);padding:16px 16px 14px;text-align:center}' +
  '.gdglb-h{font:900 13px/1 ui-monospace,Menlo,monospace;letter-spacing:.22em;color:var(--a);margin:2px 0 4px}' +
  '.gdglb-t{font:900 26px/1.05 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;letter-spacing:.02em;margin:0 0 10px;text-transform:uppercase}' +
  '.gdglb-x{position:absolute;top:8px;right:8px;width:40px;height:40px;border:0;border-radius:12px;background:rgba(255,255,255,.08);color:#fff;font:700 20px/1 sans-serif;cursor:pointer}' +
  '.gdglb-tabs{display:flex;gap:6px;justify-content:center;margin:0 0 10px;flex-wrap:wrap}' +
  '.gdglb-tab{flex:1 1 0;min-height:38px;padding:6px 8px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#dfe6f3;font:800 12px/1.1 -apple-system,sans-serif;letter-spacing:.04em;text-transform:uppercase;cursor:pointer}' +
  '.gdglb-tab.on{background:var(--a);border-color:var(--a);color:#111}' +
  '.gdglb-ol{list-style:none;margin:0;padding:0;font:700 16px/1 ui-monospace,Menlo,monospace}' +
  '.gdglb-ol li{display:flex;align-items:center;gap:10px;padding:0 12px;height:30px;border-radius:8px}' +
  '.gdglb-ol li:nth-child(odd){background:rgba(255,255,255,.045)}' +
  '.gdglb-ol .r{width:2.2em;text-align:right;color:#8fa0bd}.gdglb-ol .n{flex:1;text-align:left;letter-spacing:.18em;font-size:18px}.gdglb-ol .s{color:#fff}' +
  '.gdglb-ol li.g1 .r,.gdglb-ol li.g1 .n{color:#ffd54a}.gdglb-ol li.g2 .r{color:#d7dde8}.gdglb-ol li.g3 .r{color:#e0a46a}' +
  '.gdglb-ol li.me{background:var(--a)!important;color:#111;animation:gdglbMe 1s ease-in-out 3}.gdglb-ol li.me .r,.gdglb-ol li.me .n,.gdglb-ol li.me .s{color:#111}' +
  '@keyframes gdglbMe{50%{transform:scale(1.04);box-shadow:0 0 18px var(--a)}}' +
  '.gdglb-empty{padding:22px 8px;color:#aab6cc;font:600 15px/1.4 -apple-system,sans-serif}' +
  '.gdglb-btn{display:block;width:100%;min-height:52px;margin-top:12px;border:0;border-radius:14px;background:var(--a);color:#111;font:900 18px/1 -apple-system,sans-serif;letter-spacing:.06em;cursor:pointer;box-shadow:0 4px 0 rgba(0,0,0,.35)}' +
  '.gdglb-btn:active{transform:translateY(2px);box-shadow:0 2px 0 rgba(0,0,0,.35)}' +
  '.gdglb-skip{display:inline-block;margin-top:8px;min-height:36px;padding:8px 14px;border:0;background:none;color:#9fb0cc;font:600 14px/1 -apple-system,sans-serif;cursor:pointer}' +
  '.gdglb-sc{font:900 30px/1 ui-monospace,Menlo,monospace;margin:2px 0 2px;color:#fff;text-shadow:0 0 14px var(--a)}' +
  '.gdglb-rk{font:800 14px/1.2 -apple-system,sans-serif;color:var(--a);margin-bottom:10px;letter-spacing:.04em}' +
  '.gdglb-spin{display:flex;justify-content:center;gap:12px;margin:4px 0 2px}' +
  '.gdglb-col{display:flex;flex-direction:column;align-items:center;gap:6px}' +
  '.gdglb-ar{width:72px;height:48px;border:0;border-radius:12px;background:rgba(255,255,255,.1);color:#fff;font:900 22px/1 sans-serif;cursor:pointer;touch-action:manipulation}' +
  '.gdglb-ar:active{background:var(--a);color:#111}' +
  '.gdglb-l{width:72px;height:80px;display:flex;align-items:center;justify-content:center;border-radius:14px;background:#05080f;border:2px solid rgba(255,255,255,.18);font:900 52px/1 ui-monospace,Menlo,monospace;color:#fff;cursor:pointer}' +
  '.gdglb-l.on{border-color:var(--a);box-shadow:0 0 14px color-mix(in srgb,var(--a) 70%,transparent);color:var(--a)}' +
  '.gdglb-msg{min-height:18px;margin-top:6px;font:700 13px/1.3 -apple-system,sans-serif;color:#ff8a8a}' +
  '.gdglb-note{margin-top:8px;font:600 12px/1.3 -apple-system,sans-serif;color:#7f8ca6}' +
  '.gdglb-spinner{width:34px;height:34px;margin:24px auto;border-radius:50%;border:4px solid rgba(255,255,255,.15);border-top-color:var(--a);animation:gdglbR .8s linear infinite}@keyframes gdglbR{to{transform:rotate(360deg)}}' +
  '@media (max-height:500px) and (orientation:landscape){.gdglb-p{max-width:620px;padding:10px 14px}.gdglb-t{font-size:20px;margin-bottom:6px}.gdglb-h{font-size:11px}' +
    '.gdglb-ol{column-count:2;column-gap:12px}.gdglb-ol li{height:27px;break-inside:avoid}.gdglb-tab{min-height:32px;padding:4px 8px}.gdglb-tabs{margin-bottom:6px}' +
    '.gdglb-btn{min-height:44px;margin-top:8px;font-size:16px}.gdglb-ar{width:64px;height:38px}.gdglb-l{width:64px;height:62px;font-size:42px}.gdglb-sc{font-size:24px}.gdglb-rk{margin-bottom:4px}' +
    '.gdglb-entry{display:grid;grid-template-columns:1fr auto;gap:4px 18px;align-items:center}.gdglb-entry .gdglb-left{text-align:left}.gdglb-entry .gdglb-btn,.gdglb-entry>div:last-child{grid-column:1/-1}.gdglb-skip{margin-top:2px;min-height:30px;padding:6px 14px}}';

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function css() { if (document.getElementById('gdglb-css')) return; var s = el('style'); s.id = 'gdglb-css'; s.textContent = CSS; document.head.appendChild(s); }
  function req(path, opt) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null; var t = ctl && setTimeout(function () { ctl.abort(); }, 7000);
    opt = opt || {}; if (ctl) opt.signal = ctl.signal;
    return fetch(API + path, opt).then(function (r) { if (t) clearTimeout(t); return r.json().then(function (j) { if (!r.ok || !j.ok) { var e = new Error(j.error || ('http ' + r.status)); e.code = j.error; throw e; } return j; }); }, function (e) { if (t) clearTimeout(t); throw e; });
  }
  function getBoard(board) { return req('/scores?game=' + encodeURIComponent(C.game) + '&board=' + encodeURIComponent(board) + '&limit=10').then(function (j) { cache[board] = j.scores; return j.scores; }); }
  function better(a, b) { return C.order === 'asc' ? a < b : a > b; }
  function rankOf(list, score) { var n = 1; for (var i = 0; i < list.length; i++) if (!better(score, list[i].score)) n++; return n; }
  function close() { if (root) { root.remove(); root = null; } document.removeEventListener('keydown', onKey, true); }
  function stop(e) { e.stopPropagation(); }
  function open(inner) {
    css(); close();
    root = el('div', 'gdglb'); root.style.setProperty('--a', C.accent); root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
    ['pointerdown', 'pointerup', 'pointermove', 'touchstart', 'touchend', 'touchmove', 'mousedown', 'mouseup', 'click', 'wheel'].forEach(function (t) { root.addEventListener(t, stop, false); });
    var p = el('div', 'gdglb-p'); root.appendChild(p); p.appendChild(inner); document.body.appendChild(root);
    document.addEventListener('keydown', onKey, true);
    return p;
  }
  var keyHandler = null;
  function onKey(e) { e.stopPropagation(); if (e.key === 'Escape') { close(); return; } if (keyHandler) keyHandler(e); }
  function tap(btn, fn) { btn.addEventListener('click', function (e) { e.preventDefault(); fn(e); }); }

  function listHTML(list, hiId) {
    if (!list || !list.length) return '<div class="gdglb-empty">No scores yet.<br>Be the first on the board!</div>';
    return '<ol class="gdglb-ol">' + list.map(function (r) {
      return '<li class="g' + r.rank + (r.id === hiId ? ' me' : '') + '"><span class="r">' + r.rank + '.</span><span class="n">' + esc(r.initials) + '</span><span class="s">' + esc(C.fmt(r.score)) + '</span></li>';
    }).join('') + '</ol>';
  }
  function show(board, hiId, preset) {
    keyHandler = null;
    var ids = Object.keys(C.boards); board = board && C.boards[board] ? board : ids[0];
    var w = el('div');
    w.appendChild(el('div', 'gdglb-h', '🏆 LEADERBOARD'));
    w.appendChild(el('div', 'gdglb-t', esc(C.title)));
    var x = el('button', 'gdglb-x', '✕'); x.setAttribute('aria-label', 'Close'); tap(x, close); w.appendChild(x);
    var body = el('div');
    if (ids.length > 1) {
      var tabs = el('div', 'gdglb-tabs');
      ids.forEach(function (id) { var b = el('button', 'gdglb-tab' + (id === board ? ' on' : ''), esc(C.boards[id])); b.dataset.b = id; tap(b, function () { [].forEach.call(tabs.children, function (t) { t.classList.toggle('on', t === b); }); load(id, null); }); tabs.appendChild(b); });
      w.appendChild(tabs);
    }
    w.appendChild(body);
    var done = el('button', 'gdglb-btn', 'DONE'); tap(done, close); w.appendChild(done);
    if (C.unit) w.appendChild(el('div', 'gdglb-note', esc(C.unit)));
    open(w);
    function load(id, hi, pre) {
      if (pre) { body.innerHTML = listHTML(pre, hi); return; }
      body.innerHTML = '<div class="gdglb-spinner"></div>';
      getBoard(id).then(function (list) { if (root) body.innerHTML = listHTML(list, hi); }, function () { if (root) body.innerHTML = '<div class="gdglb-empty">The leaderboard is offline right now.<br>Your local best is still saved.</div>'; });
    }
    load(board, hiId, preset);
  }

  function entry(board, score, rank) {
    return new Promise(function (resolve) {
      var last = 'AAA'; try { last = (localStorage.getItem('gdg.initials') || 'AAA').replace(/[^A-Z]/g, '').slice(0, 3); } catch (e) {} if (last.length !== 3) last = 'AAA';
      var L = last.split('').map(function (c) { return A.indexOf(c); }), cur = 0;
      var w = el('div', 'gdglb-entry');
      var left = el('div', 'gdglb-left');
      left.appendChild(el('div', 'gdglb-h', 'NEW HIGH SCORE'));
      left.appendChild(el('div', 'gdglb-t', esc(C.title) + (Object.keys(C.boards).length > 1 ? ' · ' + esc(C.boards[board]) : '')));
      left.appendChild(el('div', 'gdglb-sc', esc(C.fmt(score))));
      left.appendChild(el('div', 'gdglb-rk', "You're #" + rank + ' · enter your initials'));
      w.appendChild(left);
      var right = el('div');
      var spin = el('div', 'gdglb-spin'), boxes = [];
      for (var i = 0; i < 3; i++) (function (i) {
        var col = el('div', 'gdglb-col'), up = el('button', 'gdglb-ar', '▲'), lt = el('div', 'gdglb-l'), dn = el('button', 'gdglb-ar', '▼');
        up.setAttribute('aria-label', 'Letter ' + (i + 1) + ' up'); dn.setAttribute('aria-label', 'Letter ' + (i + 1) + ' down');
        hold(up, function () { step(i, 1); }); hold(dn, function () { step(i, -1); });
        tap(lt, function () { cur = i; step(i, 1); });
        col.appendChild(up); col.appendChild(lt); col.appendChild(dn); spin.appendChild(col); boxes.push(lt);
      })(i);
      right.appendChild(spin);
      var msg = el('div', 'gdglb-msg'); right.appendChild(msg);
      w.appendChild(right);
      var go = el('button', 'gdglb-btn', 'ENTER ▶'); w.appendChild(go);
      var skip = el('button', 'gdglb-skip', 'skip'); var sk = el('div'); sk.appendChild(skip); w.appendChild(sk);
      function word() { return L.map(function (k) { return A[k]; }).join(''); }
      function paint() { boxes.forEach(function (b, k) { b.textContent = A[L[k]]; b.classList.toggle('on', k === cur); }); msg.textContent = BLOCK.indexOf(word()) >= 0 ? 'Pick different initials' : ''; }
      function step(i, d) { cur = i; L[i] = (L[i] + d + 26) % 26; paint(); }
      function hold(b, fn) {
        var t1 = null, t2 = null, fired = false;
        function end() { clearTimeout(t1); clearInterval(t2); t1 = t2 = null; }
        b.addEventListener('pointerdown', function (e) { e.preventDefault(); fired = true; fn(); end(); t1 = setTimeout(function () { t2 = setInterval(fn, 85); }, 380); });
        ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (t) { b.addEventListener(t, end); });
        b.addEventListener('click', function (e) { e.preventDefault(); if (!fired) fn(); fired = false; });
      }
      open(w); paint();
      keyHandler = function (e) {
        var k = (e.key || '').toUpperCase();
        if (/^[A-Z]$/.test(k)) { L[cur] = A.indexOf(k); cur = Math.min(2, cur + 1); paint(); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { step(cur, 1); e.preventDefault(); } else if (e.key === 'ArrowDown') { step(cur, -1); e.preventDefault(); }
        else if (e.key === 'ArrowLeft') { cur = Math.max(0, cur - 1); paint(); } else if (e.key === 'ArrowRight') { cur = Math.min(2, cur + 1); paint(); }
        else if (e.key === 'Backspace') { cur = Math.max(0, cur - 1); paint(); } else if (e.key === 'Enter') submit();
      };
      tap(skip, function () { close(); resolve(false); });
      tap(go, submit);
      function submit() {
        var ini = word(); if (BLOCK.indexOf(ini) >= 0) { msg.textContent = 'Pick different initials'; return; }
        if (busy) return; busy = true; go.textContent = 'SAVING…'; go.disabled = true;
        try { localStorage.setItem('gdg.initials', ini); } catch (e) {}
        req('/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game: C.game, board: board, initials: ini, score: score }) })
          .then(function (j) { busy = false; cache[board] = j.scores; try { window.GDGBoard.last = { id: j.id, token: j.delete_token, board: board }; } catch (e) {} show(board, j.id, j.scores); resolve(true); },
            function (e) { busy = false; if (e && e.code === 'initials_not_allowed') { go.disabled = false; go.textContent = 'ENTER ▶'; msg.textContent = 'Pick different initials'; return; } msg.style.color = '#ffcf6b'; msg.textContent = "Couldn't reach the leaderboard. Your local best is still saved."; setTimeout(function () { close(); resolve(false); }, 1600); });
      }
    });
  }

  window.GDGBoard = {
    init: function (cfg) { for (var k in cfg) C[k] = cfg[k]; return this; },
    show: function (board) { try { show(board); } catch (e) {} },
    close: close,
    isOpen: function () { return !!root; },
    // After a finished round: if the score makes the top 10, ask for initials, submit, show the board.
    afterRound: function (board, score) {
      if (typeof score !== 'number' || !isFinite(score) || !C.game || !C.boards[board]) return Promise.resolve(false);
      score = Math.round(score * 100) / 100;
      return getBoard(board).then(function (list) {
        var q = list.length < 10 || better(score, list[list.length - 1].score);
        if (!q) return false;
        return entry(board, score, rankOf(list, score));
      }).catch(function () { return false; });
    },
    _api: API,
  };
})();
