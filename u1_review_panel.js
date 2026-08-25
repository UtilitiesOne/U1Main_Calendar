/* U1 Review Feedback panel.
   Where findings live after the modal closes. Reads the reviews collection,
   groups by post, lets the editor tick items done. Owner sees everyone's.
   Self-contained: mounts its own button and its own panel. */
(function () {
  'use strict';

  var STATE = { reviews: [], open: false, unsub: null, status: 'starting', error: null,
                lastUpdate: 0, retryDelay: 0, retryTimer: null,
                proposals: {}, punsub: null };
  var PANEL_VERSION = "4.3";

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
    '.u1rp-ok{background:#eef7f1;border:1px solid #cfe6d8;color:#1f6b45;border-radius:5px;',
      'padding:8px 10px;font-size:12px;line-height:1.45;margin:2px 0 4px}',
    '.u1rp-stale{background:#fff8e6;border:1px solid #f0d79a;color:#7a5a10;border-radius:5px;',
      'padding:7px 9px;font-size:11.5px;line-height:1.45;margin:2px 0 9px}',
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

  /* A review describes the draft AS IT WAS at the last submit. When the editor
     saves content changes afterwards, the findings can name things they have
     already fixed, which reads as a broken gate (caught twice on 2026-08-24:
     a signature added after the check, and a resubmit against the old script).
     The submit path always writes the review AFTER the proposal, so any gap
     beyond a couple of seconds is a real post-review edit, never write skew.
     Pure and exported so the node test can hold it to that contract. */
  // Findings are also obsolete when the RULEBOOK moved on, even if the draft
  // never changed. Caught 2026-08-25: rules were fixed, the stored findings
  // stayed, and the panel showed blocks the gate no longer produces.
  function rulesMoved(reviewRulesVersion) {
    var cur = '';
    try { cur = (window.U1Gate || {}).RULES_VERSION || ''; } catch (e) {}
    return !!(cur && reviewRulesVersion && reviewRulesVersion !== cur);
  }

  function isStale(reviewAt, proposalUpdatedAt, toleranceSec) {
    var ra = reviewAt && reviewAt.seconds;
    var pa = proposalUpdatedAt && proposalUpdatedAt.seconds;
    if (!ra || !pa) return false;                 // no timestamps, no claim
    return (pa - ra) > (toleranceSec == null ? 2 : toleranceSec);
  }

  // Editors may read their own proposal; the owner may read them all. Both
  // shapes are allowed by the deployed rules, so each side gets the freshness
  // signal for exactly the drafts it can already see.
  function listenProposals() {
    var F = FB();
    if (typeof FIREBASE_ON === 'undefined' || !FIREBASE_ON || !F || !F.user) return;
    if (STATE.punsub) { try { STATE.punsub(); } catch (e) {} STATE.punsub = null; }
    var db = firebase.firestore();
    var fail = function (e) { console.warn('proposals listener:', e.message); };
    if (F.isOwner) {
      STATE.punsub = db.collection('proposals').onSnapshot(function (snap) {
        snap.docs.forEach(function (d) { STATE.proposals[d.id] = (d.data() || {}).updatedAt || null; });
        if (STATE.open) render();
      }, fail);
    } else {
      STATE.punsub = db.collection('proposals').doc(F.user.uid).onSnapshot(function (d) {
        STATE.proposals[F.user.uid] = d.exists ? ((d.data() || {}).updatedAt || null) : null;
        if (STATE.open) render();
      }, fail);
    }
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
    var F = FB();
    var myUid = (F && F.user) ? F.user.uid : null;
    body.innerHTML = STATE.reviews.map(function (r, ri) {
      var who = r.reviewer === 'auto' ? 'Brand gate'
              : r.reviewer === 'claude' ? 'Editorial review'
              : r.reviewer === 'alex' ? 'Alex' : String(r.reviewer || '');
      var head = '<div class="u1rp-meta">' + esc(who) +
        (r.level ? ' &middot; level ' + esc(r.level) : '') +
        (when(r.at) ? ' &middot; ' + esc(when(r.at)) : '') +
        (r.toEmail && window.__u1rpOwner ? ' &middot; ' + esc(r.toEmail) : '') + '</div>';
      var staleNote = '';
      if (rulesMoved(r.rulesVersion)) {
        staleNote += '<div class="u1rp-stale">The brand rules changed after this check ran, ' +
          'so these items may no longer apply. Submit again for a current list.</div>';
      }
      if (isStale(r.at, STATE.proposals[r.toUid])) {
        staleNote += '<div class="u1rp-stale">' + (r.toUid === myUid
          ? 'You have saved changes since this check ran, so some items below may already be fixed. Submit again for a fresh list.'
          : 'This editor has saved changes since this check ran, so some items may already be fixed.') + '</div>';
      }
      var total = (r.items || []).reduce(function (n, g) { return n + ((g.findings || []).length); }, 0);
      if (!total) {
        return '<div class="u1rp-rev">' + head + staleNote +
          '<div class="u1rp-ok">Nothing to fix. The last check found no issues.</div></div>';
      }
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
      return '<div class="u1rp-rev">' + head + staleNote + groups + '</div>';
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
    if (F && F.user) { listen(); listenProposals(); }
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

  var ROOT = (typeof window !== 'undefined') ? window : globalThis;
  ROOT.U1ReviewPanel = { toggle: toggle, render: render, state: STATE, badge: badge,
    isStale: isStale,
    load: function (rs) { STATE.reviews = rs; badge(); if (STATE.open) render(); } };

  // Node loads this file for the pure helpers only; everything below needs a DOM.
  if (typeof document === 'undefined') return;

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
      if (uid) { listen(); listenProposals(); }
      else { if (STATE.unsub) { STATE.unsub(); STATE.unsub = null; }
             if (STATE.punsub) { try { STATE.punsub(); } catch (e) {} STATE.punsub = null; }
             STATE.proposals = {};
             STATE.status = 'not listening: waiting for sign-in';
             STATE.reviews = []; badge(); if (STATE.open) render(); }
    }
  }, 700);
})();
