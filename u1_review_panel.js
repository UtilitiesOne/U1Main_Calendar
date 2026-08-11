/* U1 Review Feedback panel.
   Where findings live after the modal closes. Reads the reviews collection,
   groups by post, lets the editor tick items done. Owner sees everyone's.
   Self-contained: mounts its own button and its own panel. */
(function () {
  'use strict';

  var STATE = { reviews: [], open: false, unsub: null, status: 'starting', error: null };
  var PANEL_VERSION = '3.3';

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
      // Diagnostic footer (2026-08-10): when the panel is empty, show WHY, so a
      // stale script, an unattached listener, or a rules error is visible instead
      // of indistinguishable from a genuinely empty collection.
      body.innerHTML = '<p class="u1rp-empty">No review feedback yet.<br>' +
        '<span style="font-size:10.5px;opacity:.75">' + esc(STATE.status) +
        (STATE.error ? ' &middot; error: ' + esc(STATE.error) : '') +
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
    }).join('');

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
    if (typeof FIREBASE_ON === 'undefined' || !FIREBASE_ON || !window.fb || !fb.user) {
      STATE.status = 'not listening: waiting for sign-in';
      if (STATE.open) render();
      return;
    }
    window.__u1rpOwner = !!fb.isOwner;
    if (STATE.unsub) { STATE.unsub(); STATE.unsub = null; }
    var db = firebase.firestore();
    var q = fb.isOwner ? db.collection('reviews')
                       : db.collection('reviews').where('toUid', '==', fb.user.uid);
    STATE.status = 'listening as ' + (fb.user.email || fb.user.uid) + (fb.isOwner ? ' (owner, all reviews)' : ' (own reviews)');
    STATE.error = null;
    STATE.unsub = q.onSnapshot(function (snap) {
      STATE.reviews = snap.docs.map(function (d) {
        var o = d.data(); o.id = d.id; return o;
      }).sort(function (a, b) {
        var ta = a.at && a.at.seconds ? a.at.seconds : 0;
        var tb = b.at && b.at.seconds ? b.at.seconds : 0;
        return tb - ta;
      });
      badge();
      if (STATE.open) render();
    }, function (e) {
      STATE.error = e.message;
      STATE.status = 'listener failed';
      if (STATE.open) render();
      console.warn('reviews listener:', e.message);
    });
  }

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

  var t = 0;
  (function wait() {
    mountButton();
    listen();
    if (++t < 40 && (typeof FIREBASE_ON === 'undefined' || !window.fb || !fb.user)) {
      setTimeout(wait, 400);
    }
  })();
  // Sign-in usually completes AFTER the retry window above (the OAuth popup takes as
  // long as it takes), which left the panel permanently unsubscribed and empty.
  // Re-attach on every auth change (caught live by Alex 2026-08-10).
  try {
    if (typeof firebase !== 'undefined' && firebase.auth) {
      firebase.auth().onAuthStateChanged(function () { setTimeout(listen, 300); });
    }
  } catch (e) {}

  window.U1ReviewPanel = { toggle: toggle, render: render, state: STATE, badge: badge,
    load: function (rs) { STATE.reviews = rs; badge(); if (STATE.open) render(); } };
})();
