/* U1 Review Feedback panel.
   Where findings live after the modal closes. Reads the reviews collection,
   groups by post, lets the editor tick items done. Owner sees everyone's.
   Self-contained: mounts its own button and its own panel. */
(function () {
  'use strict';

  var STATE = { reviews: [], open: false, unsub: null, status: 'starting', error: null,
                lastUpdate: 0, retryDelay: 0, retryTimer: null };
  var PANEL_VERSION = "4.1";

  // The app declares `let fb = {...}` at script top level. A top-level `let` is a global
  // LEXICAL binding, not a property of window, so `window.fb` is undefined forever and
  // every window.fb check silently failed. Read the bare binding instead.
  // (Root cause of the panel never attaching; caught 2026-08-10 after three timing fixes
  // that were all treating the symptom.)
  function FB() {
    try { return (typeof fb !== 'undefined' && fb) ? fb : null; } catch (e) { return null; }
  }

  var CSS = [
    '#u1rp-btn{position:relative}',
    '#u1rp-badge{position:absolute;top:-6px;right:-8px;background:#E0621E;color:#fff;',
      'font-size:10px;font-weight:700;border-radius:9px;min-width:16px;height:16px;',
      'line-height:16px;text-align:center;padding:0 4px}',
    '#u1rp-panel{position:fixed;top:0;right:0;bottom:0;width:440px;max-width:92vw;background:#fff;',
      'box-shadow:-8px 0 34px rgba(0,0,0,.18);z-index:99998;display:flex;flex-direction:column;',
      'font-family:inherit}',
    '#u1rp-panel header{padding:16px 18px;border-bottom:1px solid #e6e8ec;display:flex;',
      'justify-content:space-between;align-items:center}',
    '#u1rp-panel h3{margin:0;font-size:15px;font-weight:700;color:#12161c}',
    '#u1rp-panel .sub{margin:3px 0 0;font-size:12px;color:#69707a}',
    '#u1rp-body{flex:1;overflow:auto;padding:4px 18px 18px}',
    '.u1rp-rev{border-top:1px solid #eef0f3;padding:14px 0}',
    '.u1rp-rev:first-child{border-top:0}',
    '.u1rp-meta{font-size:11px;color:#8a9099;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px}',
    '.u1rp-post{margin:10px 0 4px;font-size:12px;font-weight:700;color:#464d57}',
    '.u1rp-f{display:flex;gap:8px;align-items:flex-start;padding:7px 0;font-size:12.5px;line-height:1.5}',
    '.u1rp-f input{margin-top:3px;flex:0 0 auto}',
    '.u1rp-f.done{opacity:.45;text-decoration:line-through}',
    '.u1rp-lvl{font-size:9px;font-weight:700;border-radius:3px;padding:2px 5px;margin-right:5px}',
    '.u1rp-BLOCK{background:#fdeaea;color:#b3261e}',
    '.u1rp-ADVISE{background:#fff3e0;color:#9a5b00}',
    '.u1rp-WARN{background:#eef2f7;color:#5a6472}',
    '.u1rp-empty{color:#8a9099;font-size:13px;padding:24px 0;text-align:center}',
    '.u1rp-x{border:0;background:transparent;font-size:20px;cursor:pointer;color:#8a9099;line-height:1}'
  ].join('');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function style() {
    if (document.getElementById('u1rp-style')) return;
    var s = document.createElement('style'); s.id = 'u1rp-style'; s.textContent = CSS;
    document.head.appendChild(s);
  }
  function when(ts) {
    try { return ts && ts.toDate ? ts.toDate().toLocaleString() : (ts && ts.display) || ''; }
    catch (e) { return ''; }
  }
  function openCount() {
    var n = 0;
    STATE.reviews.forEach(function (r) {
      (r.items || []).forEach(function (g) {
        (g.findings || []).forEach(function (f) { if (!f.done) n++; });
      });
    });
    return n;
  }

  function render() {
    var body = document.getElementById('u1rp-body');
    if (!body) return;
    if (!STATE.reviews.length) {
      // Empty is ambiguous, so say WHY in words an editor can act on
      // (2026-08-18; the raw diagnostic string moved to the small print).
      var friendly =
        STATE.error && /permission/i.test(STATE.error)
          ? 'Feedback cannot load: the server is not set up to share it yet. This is a setup problem on our side, not something you did. Tell Alex.'
        : STATE.error
          ? 'Feedback could not load. Reload the page; if this repeats, tell Alex.'
        : /waiting for sign-in/.test(STATE.status)
          ? 'Sign in to see your feedback.'
          : 'No review feedback yet. It appears here after you submit.';
      body.innerHTML = '<p class="u1rp-empty">' + esc(friendly) + '<br>' +
        '<span style="font-size:10.5px;opacity:.6">' + esc(STATE.status) +
        (STATE.error ? ' &middot; ' + esc(STATE.error) : '') +
        ' &middot; panel v' + PANEL_VERSION + '</span></p>';
      return;
    }
    body.innerHTML = STATE.reviews.map(function (r, ri) {
      var who = r.reviewer === 'auto' ? 'Brand gate'
              : r.reviewer === 'claude' ? 'Editorial review'
              : r.reviewer === 'alex' ? 'Alex' : String(r.reviewer || '');
      var head = '<div class="u1rp-meta">' + esc(who) +
        (r.level ? ' &middot; level ' + esc(r.level) : '') +
        (when(r.at) ? ' &middot; ' + esc(when(r.at)) : '') +
        (r.toEmail && window.__u1rpOwner ? ' &middot; ' + esc(r.toEmail) : '') + '</div>';
      var groups = (r.items || []).map(function (g, gi) {
        var fs = (g.findings || []).map(function (f, fi) {
          return '<label class="u1rp-f' + (f.done ? ' done' : '') + '">' +
            '<input type="checkbox" data-r="' + ri + '" data-g="' + gi + '" data-f="' + fi + '"' +
            (f.done ? ' checked' : '') + '>' +
            '<span><span class="u1rp-lvl u1rp-' + esc(f.level) + '">' + esc(f.level) + '</span>' +
            '<b>' + esc(f.rule) + '.</b> ' + esc(f.change) + '</span></label>';
        }).join('');
        return '<div class="u1rp-post">' + esc(g.date) + ' &middot; ' + esc(g.theme) +
               (g.legacy ? ' (pre-dates the gate)' : '') + '</div>' + fs;
      }).join('');
      return '<div class="u1rp-rev">' + head + groups + '</div>';
    }).join('') +
      '<p style="font-size:10.5px;color:#8a9099;text-align:center;padding:10px 0 2px;">' +
      esc(STATE.status) +
      (STATE.lastUpdate ? ' &middot; last update ' + esc(new Date(STATE.lastUpdate).toLocaleTimeString()) : '') +
      (STATE.error ? ' &middot; ' + esc(STATE.error) : '') +
      ' &middot; panel v' + PANEL_VERSION + '</p>';

    Array.prototype.forEach.call(body.querySelectorAll('input[type=checkbox]'), function (cb) {
      cb.onchange = function () {
        var r = +cb.getAttribute('data-r'), g = +cb.getAttribute('data-g'), f = +cb.getAttribute('data-f');
        var rev = STATE.reviews[r];
        rev.items[g].findings[f].done = cb.checked;
        var row = cb.parentNode;
        if (row && row.classList) row.classList.toggle('done', cb.checked);
        badge();
        try {
          firebase.firestore().collection('reviews').doc(rev.id)
            .update({ items: rev.items })
            .catch(function (e) { console.warn('tick not saved:', e.message); });
        } catch (e) {}
      };
    });
  }

  function badge() {
    var b = document.getElementById('u1rp-badge');
    if (!b) return;
    var n = openCount();
    b.textContent = n; b.style.display = n ? 'block' : 'none';
  }

  function toggle() {
    var p = document.getElementById('u1rp-panel');
    if (p) { p.parentNode.removeChild(p); STATE.open = false; return; }
    style();
    var el = document.createElement('div');
    el.id = 'u1rp-panel';
    el.innerHTML = '<header><div><h3>Review feedback</h3>' +
      '<p class="sub">What to change, and why. Tick items as you fix them. <span style="opacity:.55">panel v' + PANEL_VERSION + '</span></p></div>' +
      '<button class="u1rp-x" id="u1rp-close">&times;</button></header>' +
      '<div id="u1rp-body"></div>';
    document.body.appendChild(el);
    document.getElementById('u1rp-close').onclick = toggle;
    STATE.open = true;
    if (!STATE.unsub) listen();
    render();
  }

  function listen() {
    var F = FB();
    if (typeof FIREBASE_ON === 'undefined' || !FIREBASE_ON || !F || !F.user) {
      STATE.status = 'not listening: waiting for sign-in';
      if (STATE.open) render();
      return;
    }
    window.__u1rpOwner = !!F.isOwner;
    if (STATE.unsub) { STATE.unsub(); STATE.unsub = null; }
    var db = firebase.firestore();
    var q = F.isOwner ? db.collection('reviews')
                      : db.collection('reviews').where('toUid', '==', F.user.uid);
    STATE.status = 'listening as ' + (F.user.email || F.user.uid) + (F.isOwner ? ' (owner, all reviews)' : ' (own reviews)');
    STATE.error = null;
    STATE.unsub = q.onSnapshot(function (snap) {
      STATE.reviews = snap.docs.map(function (d) {
        var o = d.data(); o.id = d.id; return o;
      }).sort(function (a, b) {
        var ta = a.at && a.at.seconds ? a.at.seconds : 0;
        var tb = b.at && b.at.seconds ? b.at.seconds : 0;
        return tb - ta;
      });
      STATE.lastUpdate = Date.now();
      STATE.retryDelay = 0;
      STATE.error = null;
      badge();
      if (STATE.open) render();
    }, function (e) {
      // Self-healing (v4.1): a listener error is a scheduled retry, never a
      // permanent silent death. Caught 2026-08-24: both live sessions sat on
      // stale snapshots after their listeners died with nothing on screen.
      STATE.error = e.message;
      if (STATE.unsub) { try { STATE.unsub(); } catch (x) {} STATE.unsub = null; }
      STATE.retryDelay = Math.min((STATE.retryDelay || 2500) * 2, 60000);
      STATE.status = 'listener failed; retrying in ' + Math.round(STATE.retryDelay / 1000) + 's';
      if (STATE.retryTimer) clearTimeout(STATE.retryTimer);
      STATE.retryTimer = setTimeout(listen, STATE.retryDelay);
      if (STATE.open) render();
      console.warn('reviews listener:', e.message);
    });
  }

  // Re-attach whenever the tab wakes or the network returns: the cheapest cure
  // for a websocket that died while the laptop slept.
  function relisten() {
    var F = FB();
    if (F && F.user) listen();
  }
  try {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') relisten();
    });
    window.addEventListener('online', relisten);
  } catch (e) {}

  function mountButton() {
    if (document.getElementById('u1rp-btn')) return true;
    var host = document.querySelector('.topbar, .top-bar, header') || document.body;
    style();
    var b = document.createElement('button');
    b.id = 'u1rp-btn';
    b.style.cssText = 'margin-left:10px;padding:7px 12px;font-size:11px;font-weight:700;' +
      'letter-spacing:.04em;border:1px solid #d5d9df;background:#fff;border-radius:5px;cursor:pointer';
    b.innerHTML = 'REVIEW FEEDBACK<span id="u1rp-badge" style="display:none">0</span>';
    b.onclick = toggle;
    host.appendChild(b);
    return true;
  }

  mountButton();
  // Attach when a user actually appears, however long that takes. The earlier
  // bounded retry expired before sign-in and the onAuthStateChanged hook could not
  // bind because this script runs before the app initializes Firebase. A standing
  // poller costs nothing and cannot miss the transition (caught live 2026-08-10:
  // the panel reported "not listening: waiting for sign-in" indefinitely).
  var lastUid = null;
  setInterval(function () {
    mountButton();
    var F = FB();
    var uid = (F && F.user && F.user.uid) ? F.user.uid : null;
    if (uid !== lastUid) {
      lastUid = uid;
      if (uid) listen();
      else { if (STATE.unsub) { STATE.unsub(); STATE.unsub = null; }
             STATE.status = 'not listening: waiting for sign-in';
             STATE.reviews = []; badge(); if (STATE.open) render(); }
    }
  }, 700);

  window.U1ReviewPanel = { toggle: toggle, render: render, state: STATE, badge: badge,
    load: function (rs) { STATE.reviews = rs; badge(); if (STATE.open) render(); } };
})();
