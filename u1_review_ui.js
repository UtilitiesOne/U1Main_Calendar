/* U1 brand gate, UI layer.
   Self-contained. Integration is one script tag after the app script.
   It wraps submitForApproval rather than editing app internals, so the host
   file changes by two lines and the gate can be pulled out again cleanly. */
(function () {
  'use strict';

  var BASELINE = window.U1_LEGACY_BASELINE || { keys: {} };
  var LEVEL_ORDER = { BLOCK: 0, ADVISE: 1, WARN: 2 };

  function themeMap() {
    var m = {};
    try {
      (BRAND_CONFIG.themes || []).forEach(function (t) {
        m[t.id] = { name: t.name, tagline: t.tagline || '',
                    act: !!t.bodyActivationRequired };
      });
    } catch (e) {}
    return m;
  }
  function inferTheme(text, declared, TH) {
    if (declared && TH[declared]) return declared;
    var t = String(text || '').toLowerCase();
    if (t.indexOf('one company. every utility') > -1) return 't6';
    if (t.indexOf('from paper to field') > -1) return 't5';
    if (t.indexOf('built to hold') > -1) return 't1';
    return 't6';
  }

  /* Runs gate + scope over the current editing state. */
  function evaluateCurrent() {
    var TH = themeMap();
    var scoped = window.U1Scope.resolve(state, BASELINE);
    var groups = [];
    scoped.forEach(function (r) {
      if (r.scope === 'silent') return;
      var th = inferTheme(r.post.text, r.post.themeId, TH);
      var meta = TH[th] || { name: th, tagline: '', act: false };
      // Recalibrated 2026-08-10 (approved): the submitter's per-post tagline is the
      // DECLARATION of what the artwork carries. It wins over the theme default, and
      // body activation keys off the declared line, not the theme flag.
      var declared = (r.post.tagline !== undefined) ? r.post.tagline : meta.tagline;
      var needsAct = String(declared || '').trim().toLowerCase() === 'one company. every utility.';
      var items = window.U1Gate.checkPost({
        date: r.post.date, themeId: th, themeName: meta.name,
        tagline: declared, bodyActivationRequired: needsAct,
        text: r.post.text, trustLine: r.post.trustLine
      });
      items = window.U1Scope.applyScope(items, r.scope);
      if (!items.length) return;
      items.sort(function (a, b) { return LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]; });
      groups.push({ date: r.post.date, theme: meta.name, legacy: r.legacy,
                    scope: r.scope, items: items });
    });
    // Division lanes (calendar v3, 2026-08-10): always governed, never legacy.
    // The lane metadata comes from the app's LANES table when present.
    var lanesDef = (typeof LANES !== 'undefined') ? LANES : [];
    var laneMap = (state && state.lanes) || {};
    lanesDef.forEach(function (l) {
      if (l.id === 'parent') return;
      (((laneMap[l.id] || {}).posts) || []).forEach(function (p) {
        var items2 = window.U1Gate.checkPost({
          date: p.date, themeId: '', themeName: l.name + ' lane',
          tagline: p.tagline || '', bodyActivationRequired: false,
          text: p.note, trustLine: p.trustLine,
          laneId: l.id, laneName: l.name, laneTag: l.tag
        });
        if (typeof findLaneDuplicate === 'function') {
          var dup = findLaneDuplicate(l.id, p.id, p.note);
          if (dup) items2.push({ level: 'BLOCK', rule: 'Duplicate across pages',
            why: 'This body also runs on the ' + dup.lane.name + ' lane. The same post never runs on two pages; a post that fits more than one division belongs on U1 Main.',
            change: 'Keep it on one lane, or move it to U1 Main.', quote: null });
        }
        if (!items2.length) return;
        items2.sort(function (a, b) { return LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]; });
        groups.push({ date: p.date, theme: l.name + ' lane', legacy: false,
                      scope: 'enforce', items: items2 });
      });
    });
    // Blocking posts first: what is stopping the submission has to be what the
    // editor reads first. Then advise, then warn-only, each by date.
    function rank(g) {
      if (g.items.some(function (i) { return i.level === 'BLOCK'; })) return 0;
      if (g.items.some(function (i) { return i.level === 'ADVISE'; })) return 1;
      return 2;
    }
    groups.sort(function (a, b) {
      var r = rank(a) - rank(b);
      return r !== 0 ? r : (a.date < b.date ? -1 : 1);
    });
    var all = groups.reduce(function (a, g) { return a.concat(g.items); }, []);
    return { groups: groups, all: all, canSubmit: window.U1Scope.canSubmit(all),
             blocks: all.filter(function (i) { return i.level === 'BLOCK'; }).length,
             advise: all.filter(function (i) { return i.level === 'ADVISE'; }).length,
             warns:  all.filter(function (i) { return i.level === 'WARN'; }).length };
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var STYLE = [
    '.u1g-back{position:fixed;inset:0;background:rgba(12,16,22,.62);z-index:99999;',
      'display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;overflow:auto}',
    '.u1g-card{background:#fff;max-width:760px;width:100%;border-radius:10px;',
      'box-shadow:0 18px 60px rgba(0,0,0,.3);font-family:inherit;overflow:hidden}',
    '.u1g-head{padding:18px 22px;border-bottom:1px solid #e6e8ec}',
    '.u1g-h{font-size:17px;font-weight:700;color:#12161c;margin:0 0 4px}',
    '.u1g-sub{font-size:13px;color:#69707a;margin:0}',
    '.u1g-body{padding:6px 22px 4px;max-height:56vh;overflow:auto}',
    '.u1g-post{border-top:1px solid #eef0f3;padding:14px 0}',
    '.u1g-post:first-child{border-top:0}',
    '.u1g-pt{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#8a9099;margin-bottom:9px}',
    '.u1g-item{display:flex;gap:10px;padding:9px 0}',
    '.u1g-pill{flex:0 0 auto;font-size:10px;font-weight:700;letter-spacing:.05em;border-radius:3px;',
      'padding:3px 6px;height:fit-content;line-height:1.1}',
    '.u1g-BLOCK{background:#fdeaea;color:#b3261e}',
    '.u1g-ADVISE{background:#fff3e0;color:#9a5b00}',
    '.u1g-WARN{background:#eef2f7;color:#5a6472}',
    '.u1g-rule{font-weight:650;color:#12161c;font-size:13.5px;margin-bottom:2px}',
    '.u1g-why{color:#464d57;font-size:13px;line-height:1.55;margin:0 0 5px}',
    '.u1g-do{color:#12161c;font-size:13px;line-height:1.55;margin:0}',
    '.u1g-do b{font-weight:650}',
    '.u1g-q{display:inline-block;background:#f4f6f8;border-radius:3px;padding:1px 5px;',
      'font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:#3a424c;margin-top:4px}',
    '.u1g-foot{padding:14px 22px;border-top:1px solid #e6e8ec;display:flex;',
      'justify-content:space-between;align-items:center;gap:12px;background:#fafbfc}',
    '.u1g-note{font-size:12px;color:#69707a;margin:0}',
    '.u1g-btns{display:flex;gap:8px}',
    '.u1g-b{border:1px solid #d5d9df;background:#fff;color:#12161c;border-radius:6px;',
      'padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer}',
    '.u1g-b.pri{background:#E0621E;border-color:#E0621E;color:#fff}'
  ].join('');

  function ensureStyle() {
    if (document.getElementById('u1g-style')) return;
    var s = document.createElement('style');
    s.id = 'u1g-style'; s.textContent = STYLE;
    document.head.appendChild(s);
  }

  function itemHtml(i) {
    return '<div class="u1g-item">' +
      '<span class="u1g-pill u1g-' + i.level + '">' + i.level + '</span>' +
      '<div><div class="u1g-rule">' + esc(i.rule) + '</div>' +
      '<p class="u1g-why">' + esc(i.why) + (i.legacyNote ? ' ' + esc(i.legacyNote) : '') + '</p>' +
      '<p class="u1g-do"><b>Change:</b> ' + esc(i.change) + '</p>' +
      (i.quote ? '<span class="u1g-q">' + esc(i.quote) + '</span>' : '') +
      '</div></div>';
  }

  function fmtDate(d) {
    try {
      var p = String(d).split('-');
      return new Date(+p[0], +p[1] - 1, +p[2])
        .toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) { return d; }
  }

  function showAdvisory(res, onProceed) {
    ensureStyle();
    var blocked = !res.canSubmit;
    var title = blocked
      ? 'Not submitted yet. ' + res.blocks + (res.blocks === 1 ? ' thing' : ' things') + ' to fix first.'
      : 'Submitted. ' + (res.advise + res.warns) + ' note' + ((res.advise + res.warns) === 1 ? '' : 's') + ' for you.';
    var sub = blocked
      ? 'These are the brand rules the calendar runs on. Fix them in the post and submit again.'
      : 'Nothing here blocked your submission. Worth a look while the post is still open.';

    var body = res.groups.map(function (g) {
      return '<div class="u1g-post"><div class="u1g-pt">' + fmtDate(g.date) + ' &middot; ' + esc(g.theme) +
        (g.legacy ? ' &middot; pre-dates the gate' : '') + '</div>' +
        g.items.map(itemHtml).join('') + '</div>';
    }).join('');

    var back = document.createElement('div');
    back.className = 'u1g-back';
    back.innerHTML = '<div class="u1g-card"><div class="u1g-head">' +
      '<p class="u1g-h">' + esc(title) + '</p><p class="u1g-sub">' + esc(sub) + '</p></div>' +
      '<div class="u1g-body">' + body + '</div>' +
      '<div class="u1g-foot"><p class="u1g-note">' +
        (blocked ? 'Nothing was sent. Your work is saved.' : 'Sent to the owner for review.') +
      '</p><div class="u1g-btns">' +
        '<button class="u1g-b" data-x="close">' + (blocked ? 'Back to the post' : 'Close') + '</button>' +
        (blocked && (function () { try { return typeof fb !== 'undefined' && fb && fb.isOwner; } catch (e) { return false; } })()
          ? '<button class="u1g-b pri" data-x="force">Override and submit</button>' : '') +
      '</div></div></div>';
    document.body.appendChild(back);
    back.addEventListener('click', function (e) {
      var x = e.target && e.target.getAttribute && e.target.getAttribute('data-x');
      if (x === 'close' || e.target === back) back.remove();
      if (x === 'force') { back.remove(); onProceed(true); }
    });
  }

  /* Writes the findings so the editor keeps them after the modal closes. */
  function writeReview(res) {
    try {
      if (typeof FIREBASE_ON === 'undefined' || !FIREBASE_ON || !fb.user) return;
      firebase.firestore().collection('reviews').add({
        toUid: fb.user.uid,
        toEmail: fb.user.email || '',
        reviewer: 'auto',
        level: 1,
        verdict: res.canSubmit ? 'notes' : 'changes-requested',
        counts: { block: res.blocks, advise: res.advise, warn: res.warns },
        items: res.groups.map(function (g) {
          return { date: g.date, theme: g.theme, legacy: !!g.legacy,
                   findings: g.items.map(function (i) {
                     return { level: i.level, rule: i.rule, why: i.why,
                              change: i.change, quote: i.quote || '', done: false };
                   }) };
        }),
        at: firebase.firestore.FieldValue.serverTimestamp(),
        read: false
      }).catch(function (e) { console.warn('review write skipped:', e.message); });
    } catch (e) { console.warn('review write error', e); }
  }

  /* Stamps the review pipeline stage on the proposal.
     l1 is the automatic gate result. l2 is the judgement stage and is only ever
     set to pending here; moving it to in-review or done is the owner's or the
     service account's job, and the rules enforce that. */
  function markStages(clean) {
    try {
      if (typeof FIREBASE_ON === 'undefined' || !FIREBASE_ON || !fb.user) return;
      var patch = { l1: clean ? 'clean' : 'blocked', l1At: firebase.firestore.FieldValue.serverTimestamp() };
      if (clean) patch.l2 = 'pending';
      // merge, not update: the proposal doc may still be mid-write from the
      // app's own save when this runs.
      firebase.firestore().collection('proposals').doc(fb.user.uid)
        .set(patch, { merge: true })
        .catch(function (e) { console.warn('stage stamp skipped:', e.message); });
    } catch (e) {}
  }

  function install() {
    if (typeof window.submitForApproval !== 'function') return false;
    if (window.__u1gInstalled) return true;
    var original = window.submitForApproval;
    window.__u1gOwner = !!(window.fb && fb.isOwner);

    window.submitForApproval = function () {
      var res;
      try { res = evaluateCurrent(); }
      catch (e) { console.warn('U1 gate error, submitting unchecked:', e); return original.apply(this, arguments); }

      if (!res.all.length) {
        original.apply(this, arguments);
        markStages(true);
        return;
      }

      if (res.canSubmit) {
        original.apply(this, arguments);
        markStages(true);
        writeReview(res);
        showAdvisory(res, function () {});
        return;
      }
      markStages(false);
      writeReview(res);
      showAdvisory(res, function (force) {
        if (force) { original.call(window); markStages(true); }
      });
    };
    window.__u1gInstalled = true;
    window.U1GateUI = { evaluate: evaluateCurrent, show: showAdvisory };
    return true;
  }

  var tries = 0;
  (function wait() {
    if (install()) return;
    if (++tries > 60) { console.warn('U1 gate: submitForApproval not found'); return; }
    setTimeout(wait, 250);
  })();
})();
