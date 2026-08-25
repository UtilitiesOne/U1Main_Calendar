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

  // The app declares `let fb`, a lexical global that never lands on window.
  function FB() {
    try { return (typeof fb !== 'undefined' && fb) ? fb : null; } catch (e) { return null; }
  }

  /* Runs gate + scope over a calendar state. Defaults to the one being edited;
     the publish gate passes the state about to go live (2026-08-11).

     ownBase (2026-08-18): the state this editor started from. When present, a
     post identical to the editor's starting point is someone else's problem and
     is skipped entirely, so a submission blocks only on work THIS editor added
     or changed. Without it two unfixed posts in the shared calendar froze every
     editor's submission and the modal told them to fix posts they never wrote.
     The publish path passes no ownBase: the owner judges the whole calendar. */
  function ownKeys(ownBase) {
    if (!ownBase) return null;
    var m = {};
    window.U1Scope.postsFrom(ownBase).forEach(function (p) {
      m[p.key] = window.U1Scope.fingerprint(p) + '||' + (p.tagline || '') + '||' + (p.image || '');
    });
    var lanes = ownBase.lanes || {};
    Object.keys(lanes).forEach(function (id) {
      ((lanes[id] || {}).posts || []).forEach(function (p) {
        m['lane|' + id + '|' + p.id] = JSON.stringify([p.date, p.note, p.trustLine, p.tagline, p.image, p.category]);
      });
    });
    return m;
  }

  function evaluateState(st, ownBase) {
    var target = st || state;
    var TH = themeMap();
    var mine = ownKeys(ownBase);
    var scoped = window.U1Scope.resolve(target, BASELINE);
    var groups = [];
    scoped.forEach(function (r) {
      if (r.scope === 'silent') return;
      if (mine && mine[r.post.key] === window.U1Scope.fingerprint(r.post) + '||' + (r.post.tagline || '') + '||' + (r.post.image || '')) return;
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
        text: r.post.text, trustLine: r.post.trustLine,
        image: r.post.image, imageMeta: r.post.imageMeta
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
    var laneMap = (target && target.lanes) || {};
    lanesDef.forEach(function (l) {
      if (l.id === 'parent') return;
      (((laneMap[l.id] || {}).posts) || []).forEach(function (p) {
        if (mine && mine['lane|' + l.id + '|' + p.id] === JSON.stringify([p.date, p.note, p.trustLine, p.tagline, p.image, p.category])) return;
        // Lane grandfathering (2026-08-18): lane posts in the frozen baseline are
        // legacy like parent posts. Untouched -> silent, edited -> advise, new ->
        // enforce. Before this every lane post was hardcoded governed, which
        // re-blocked lane work the owner had already published.
        var known = (BASELINE.keys || {})[window.U1Scope.laneKey(l.id, p.id)];
        var laneScope = known === undefined ? 'enforce'
                      : known === window.U1Scope.laneFingerprint(p) ? 'silent' : 'advise';
        if (laneScope === 'silent') return;
        var items2 = window.U1Gate.checkPost({
          date: p.date, themeId: '', themeName: l.name + ' lane',
          tagline: p.tagline || '', bodyActivationRequired: false,
          text: p.note, trustLine: p.trustLine,
          image: p.image, imageMeta: p.imageMeta,
          laneId: l.id, laneName: l.name, laneTag: l.tag
        });
        if (typeof findLaneDuplicate === 'function' && target === state) {
          var dup = findLaneDuplicate(l.id, p.id, p.note);
          if (dup) items2.push({ level: 'BLOCK', rule: 'Duplicate across pages',
            why: 'This body also runs on the ' + dup.lane.name + ' lane. The same post never runs on two pages; a post that fits more than one division belongs on U1 Main.',
            change: 'Keep it on one lane, or move it to U1 Main.', quote: null });
        }
        items2 = window.U1Scope.applyScope(items2, laneScope);
        if (!items2.length) return;
        items2.sort(function (a, b) { return LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]; });
        groups.push({ date: p.date, theme: l.name + ' lane', legacy: laneScope === 'advise',
                      scope: laneScope, items: items2 });
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


  /* Per-change publish gate (2026-08-18). Judges one changed unit at a time
     against exactly what caused the earlier whole-batch freeze: a single
     broken post held the entire proposal hostage, and the only way through
     was the owner overriding everything, blocked content included. Every
     changed key gets its own verdict here, tied to whoever changed it, so a
     clean change can go live regardless of what else nearby is not ready. */
  function evaluatePerChange(changes) {
    var TH = themeMap();
    var out = [];
    changes.forEach(function (c) {
      if (c.removed) { out.push({ key: c.key, date: c.date, pass: true, removed: true, items: [] }); return; }
      var obj = c.candidate.obj;
      var items;
      if (c.kind === 'lane') {
        var known = (BASELINE.keys || {})[window.U1Scope.laneKey(c.laneId, obj.id)];
        var laneScope = known === undefined ? 'enforce'
                      : known === window.U1Scope.laneFingerprint(obj) ? 'silent' : 'advise';
        items = laneScope === 'silent' ? [] : window.U1Gate.checkPost({
          date: obj.date, themeId: '', themeName: c.laneId + ' lane',
          tagline: obj.tagline || '', bodyActivationRequired: false,
          text: obj.note, trustLine: obj.trustLine,
          image: obj.image, imageMeta: obj.imageMeta,
          laneId: c.laneId, laneName: c.laneId, laneTag: '#' + c.laneId
        });
        items = window.U1Scope.applyScope(items, laneScope);
      } else {
        var th = inferTheme(obj.note, obj.themeId, TH);
        var meta = TH[th] || { name: th, tagline: '', act: false };
        var declared = ('tagline' in obj) ? obj.tagline : meta.tagline;
        var needsAct = String(declared || '').trim().toLowerCase() === 'one company. every utility.';
        var fp = window.U1Scope.fingerprint({ text: obj.note, trustLine: obj.trustLine, themeId: obj.themeId });
        var known2 = (BASELINE.keys || {})[c.key];
        var scope = known2 === undefined ? 'enforce' : known2 === fp ? 'silent' : 'advise';
        items = scope === 'silent' ? [] : window.U1Gate.checkPost({
          date: c.date, themeId: th, themeName: meta.name,
          tagline: declared, bodyActivationRequired: needsAct,
          text: obj.note, trustLine: obj.trustLine,
          image: obj.image, imageMeta: obj.imageMeta
        });
        items = window.U1Scope.applyScope(items, scope);
      }
      var pass = !items.some(function (i) { return i.level === 'BLOCK'; });
      out.push({ key: c.key, date: c.date, pass: pass, removed: false, items: items });
    });
    return out;
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

  function showAdvisory(res, onProceed, opts) {
    ensureStyle();
    var pub = !!(opts && opts.publish);
    var blocked = !res.canSubmit;
    var title = blocked
      ? (pub ? 'Not published. ' : 'Not submitted yet. ') + res.blocks + (res.blocks === 1 ? ' thing' : ' things') + ' to fix first.'
      : (pub ? 'Published. ' : 'Submitted. ') + (res.advise + res.warns) + ' note' + ((res.advise + res.warns) === 1 ? '' : 's') + ' for you.';
    var sub = blocked
      ? (pub
          ? 'These posts would go live carrying brand-rule violations. Fix them, or override and it goes on the record.'
          : 'These are the brand rules the calendar runs on. Fix them in the post and submit again.')
      : 'Nothing here blocked it. Worth a look while the post is still open.';

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
        (blocked ? (pub ? 'Nothing went live. The proposal is untouched.' : 'Nothing was sent. Your work is saved.')
                 : (pub ? 'Live calendar updated.' : 'Sent to the owner for review.')) +
      '</p><div class="u1g-btns">' +
        '<button class="u1g-b" data-x="close">' + (blocked ? (pub ? 'Back' : 'Back to the post') : 'Close') + '</button>' +
        (blocked && (function () { var F = FB(); return F && F.isOwner; })()
          ? '<button class="u1g-b pri" data-x="force">' + (pub ? 'Override and publish' : 'Override and submit') + '</button>' : '') +
      '</div></div></div>';
    document.body.appendChild(back);
    back.addEventListener('click', function (e) {
      var x = e.target && e.target.getAttribute && e.target.getAttribute('data-x');
      if (x === 'close' || e.target === back) back.remove();
      if (x === 'force') { back.remove(); onProceed(true); }
    });
  }

  /* A failure the editor should know about is shown, not logged. The strip is
     dismissible and non-modal: it must never block the work it reports on. */
  function notice(msg) {
    try {
      var el = document.getElementById('u1g-notice');
      if (!el) {
        el = document.createElement('div');
        el.id = 'u1g-notice';
        el.style.cssText = 'position:fixed;bottom:14px;left:14px;right:14px;z-index:99997;' +
          'background:#3a2c14;color:#ffd9a0;border:1px solid #9a5b00;border-radius:8px;' +
          'padding:10px 40px 10px 14px;font-size:12.5px;line-height:1.5;box-shadow:0 8px 30px rgba(0,0,0,.35)';
        var x = document.createElement('button');
        x.textContent = '×';
        x.style.cssText = 'position:absolute;right:8px;top:6px;border:0;background:transparent;color:#ffd9a0;font-size:18px;cursor:pointer';
        x.onclick = function () { el.remove(); };
        el.appendChild(x);
        var span = document.createElement('span');
        span.id = 'u1g-notice-text';
        el.insertBefore(span, x);
        document.body.appendChild(el);
      }
      document.getElementById('u1g-notice-text').textContent = msg;
    } catch (e) { console.warn(msg); }
  }

  /* Writes the findings so the editor keeps them after the modal closes.
     One document per editor, replaced on every run (2026-08-18): the findings
     are derived state, so stale sets from earlier attempts only mislead. The
     override audit trail lives in /overrides and is untouched by this. */
  function writeReview(res) {
    try {
      if (typeof FIREBASE_ON === 'undefined' || !FIREBASE_ON || !fb.user) return;
      firebase.firestore().collection('reviews').doc('auto_' + fb.user.uid).set({
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
        rulesVersion: (window.U1Gate && window.U1Gate.RULES_VERSION) || '',
        at: firebase.firestore.FieldValue.serverTimestamp(),
        read: false
      }).catch(function (e) {
        console.warn('review write skipped:', e.message);
        notice('Your feedback list could not be saved to the server (' + e.message + '). The submission itself is not affected, but Review Feedback may show an older list. Tell Alex.');
      });
    } catch (e) { console.warn('review write error', e); }
  }

  /* Stamps the review pipeline stage on the proposal.
     l1 is the automatic gate result. l2 is the judgement stage and is only ever
     set to pending here; moving it to in-review or done is the owner's or the
     service account's job, and the rules enforce that. */
  function markStages(clean) {
    try {
      if (typeof FIREBASE_ON === 'undefined' || !FIREBASE_ON || !fb.user) return;
      // l2 is server-owned since 2026-08-18 night; the client stamps l1 only.
      var patch = { l1: clean ? 'clean' : 'blocked', l1At: firebase.firestore.FieldValue.serverTimestamp() };
      // merge, not update: the proposal doc may still be mid-write from the
      // app's own save when this runs.
      firebase.firestore().collection('proposals').doc(fb.user.uid)
        .set(patch, { merge: true })
        .catch(function (e) {
          console.warn('stage stamp skipped:', e.message);
          notice('The review stage could not be recorded on the server (' + e.message + '). Your submission may not appear as ready in the Review tab. Tell Alex.');
        });
    } catch (e) {}
  }

  /* An override is a decision on the record: who, when, what was pushed through.
     Immutable by rule. Added 2026-08-11 with the server-side enforcement. */
  function logOverride(kind, res, note) {
    try {
      var F = FB();
      if (typeof FIREBASE_ON === 'undefined' || !FIREBASE_ON || !F || !F.user) return;
      var rules = [];
      (res.groups || []).forEach(function (g) {
        (g.items || []).forEach(function (i) {
          if (i.level === 'BLOCK') rules.push(g.date + ' ' + g.theme + ': ' + i.rule);
        });
      });
      firebase.firestore().collection('overrides').add({
        kind: kind,
        by: F.user.email || '',
        uid: F.user.uid,
        blocks: res.blocks,
        rules: rules,
        note: note || '',
        at: firebase.firestore.FieldValue.serverTimestamp()
      }).catch(function (e) { console.warn('override log skipped:', e.message); });
    } catch (e) {}
  }

  /* Stamps the gate verdict on the client state BEFORE the app writes the
     proposal, so submitted:true and l1:'clean' land in one document. The
     server rule refuses a submitted proposal whose l1 is not clean, so the
     order matters (2026-08-11). */
  function stampVerdict(clean) {
    var F = FB();
    if (!F) return;
    F.l1 = clean ? 'clean' : 'blocked';
  }

  function install() {
    if (typeof window.submitForApproval !== 'function') return false;
    if (window.__u1gInstalled) return true;
    var original = window.submitForApproval;
    var F0 = FB();
    window.__u1gOwner = !!(F0 && F0.isOwner);

    window.submitForApproval = function () {
      var res;
      // Fail CLOSED (2026-08-18). This catch used to stamp l1 clean and submit
      // unchecked, so a crash in the gate certified a post as having passed it.
      // A gate that cannot run refuses and says so; it never vouches blind.
      try { res = evaluateState(state, FB() && FB().baseState); }
      catch (e) {
        console.warn('U1 gate error, submission refused:', e);
        notice('The brand check itself failed to run (' + (e && e.message ? e.message : e) + '), so nothing was submitted. Reload the page and try again; if it repeats, tell Alex.');
        return;
      }

      if (!res.all.length) {
        stampVerdict(true);
        original.apply(this, arguments);
        markStages(true);
        // Write the empty result too. Skipping it left the previous attempt's
        // findings in place forever, so a post fixed to perfection still showed
        // its old blocks and the gate looked broken (caught 2026-08-25).
        writeReview(res);
        return;
      }

      if (res.canSubmit) {
        stampVerdict(true);
        original.apply(this, arguments);
        markStages(true);
        writeReview(res);
        showAdvisory(res, function () {});
        return;
      }
      stampVerdict(false);
      markStages(false);
      writeReview(res);
      showAdvisory(res, function (force) {
        if (force) { logOverride('submit', res, 'blocked submit pushed through by owner'); stampVerdict(true); original.call(window); markStages(true); }
      });
    };
    window.__u1gInstalled = true;

  /* Per-post publish (2026-08-18). This is the fix for the freeze: a proposal
     is no longer accepted or refused as one unit. Every changed post is judged
     on its own; whatever clears goes live, whatever does not stays exactly as
     drafted in the editor's own proposal, held for them to fix, never lost and
     never blocking anyone else's clean work. */
  function publishPerPost(candidateState, source, proposalId, proposerEmail, notifyOwner) {
    var live = window.__liveState || {};
    var changes = window.U1Scope.diffAgainstLive(candidateState, live);
    var verdicts = evaluatePerChange(changes);
    var passKeys = {};
    verdicts.forEach(function (v) { if (v.pass) passKeys[v.key] = 1; });
    var held = verdicts.filter(function (v) { return !v.pass; });
    var toPublish = window.U1Scope.applySelectedChanges(live, changes, passKeys);
    var nothingChanged = JSON.stringify(toPublish) === JSON.stringify(live);

    var result = { publishedCount: changes.length - held.length, held: held, published: !nothingChanged };

    var afterPublish = function () {
      // The proposal doc is kept alive only when real work is still held; a
      // clean sweep behaves exactly like the old all-or-nothing publish.
      if (!proposalId) return Promise.resolve(result);
      if (!held.length) {
        return firebase.firestore().collection('proposals').doc(proposalId).delete()
          .catch(function () {}).then(function () { return result; });
      }
      return firebase.firestore().collection('proposals').doc(proposalId).set({
        baseVersion: window.__liveVersion,
        baseState: fbClone(window.__liveState),
        submitted: false,
        l1: 'blocked',
        l1At: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true }).catch(function (e) { console.warn('proposal follow-up write skipped:', e.message); })
        .then(function () { return result; });
    };

    if (nothingChanged) {
      return afterPublish();
    }

    var msg = held.length
      ? ('The owner published ' + result.publishedCount + ' of your changes as v{V}. ' +
         held.length + ' still need work, and are sitting in your draft, unchanged.')
      : (notifyOwner || 'Your proposal was approved and published as v{V}.');

    return guardedPublish(toPublish, window.__liveVersion, source, proposalId, msg, true)
      .then(afterPublish);
  }

    window.U1GateUI = { evaluate: evaluateState, show: showAdvisory, publishPerPost: publishPerPost };
    return true;
  }

  /* Publish gate (2026-08-11). guardedPublish is the single choke point for every
     path that writes the live calendar: direct publish, rebase and publish, and
     version restore. Wrapping it closes the owner-shaped hole, where edits made
     and published directly never met the gate. */
  function installPublish() {
    if (typeof window.guardedPublish !== 'function') return false;
    if (window.__u1gPublishInstalled) return true;
    var orig = window.guardedPublish;
    window.guardedPublish = function (stateObj, expectedVersion, source, proposalId) {
      // Every branch returns a real promise now (2026-08-18): publishPerPost
      // depends on that to know whether its already-filtered, should-always-
      // pass payload genuinely went live, rather than silently reporting
      // success on a call that actually stopped for a manual click.
      var self = this, args = arguments, res;
      try { res = evaluateState(stateObj); }
      catch (e) {
        console.warn('U1 gate error on publish:', e);
        if (confirm('The brand check itself failed to run, so this publish is UNCHECKED.\n\nPublish anyway?')) return orig.apply(self, args);
        return Promise.reject(new Error('publish cancelled: gate error, not confirmed'));
      }
      if (res.canSubmit) return orig.apply(self, args);
      // Should not happen: publishPerPost only ever sends content it has
      // already gated clean. If this fires, something disagrees with itself,
      // and that is worth a loud modal, not a silent false success.
      return new Promise(function (resolve, reject) {
        showAdvisory(res, function (force) {
          if (force) { logOverride('publish', res, String(source || '')); resolve(orig.apply(self, args)); }
          else reject(new Error('publish held: the whole-state check disagreed with the per-post check'));
        }, { publish: true });
      });
    };
    window.__u1gPublishInstalled = true;
    return true;
  }

  var tries = 0;
  (function wait() {
    var a = install(), b = installPublish();
    if (a && b) return;
    if (++tries > 60) { console.warn('U1 gate: submit or publish hook not found'); return; }
    setTimeout(wait, 250);
  })();
})();
