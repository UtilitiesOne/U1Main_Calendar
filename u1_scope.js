/* U1 gate scope resolver.
   Decides, per post, whether the Level-1 gate enforces, warns, or stays silent.

   Grandfathering rule agreed 2026-08-07:
     - Posts that existed at go-live are LEGACY.
         untouched  -> silent   (never checked)
         edited     -> advise   (findings shown, submission never blocked)
     - Posts created after go-live are GOVERNED.
         always     -> enforce  (BLOCK items stop submission)
   The legacy baseline is a frozen snapshot of post keys taken at go-live. It is
   deliberately a fixed list, not "whatever is currently live", so a post added
   after cutover can never drift into legacy status by being published. */
(function (root) {
  'use strict';

  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  // Stable identity for a post. Date plus kind is enough: one scheduled slot per
  // date, and events carry their own date.
  function keyFor(kind, date, idx) {
    return kind + '|' + date + (kind === 'event' && idx != null ? '|' + idx : '');
  }

  // Cheap content fingerprint. Only the fields a writer controls.
  function fingerprint(p) {
    return norm(p.text) + '||' + norm(p.trustLine) + '||' + norm(p.themeId);
  }

  /* Extracts a comparable post list from a calendar state object. */
  function postsFrom(state) {
    var out = [];
    var so = (state && state.slotOverrides) || {};
    Object.keys(so).forEach(function (date) {
      var v = so[date];
      // A skipped slot is removed in app terms even when its note text is still
      // stored. Counting it as a live post made the gate check phantom content
      // (caught 2026-08-18 on the skipped Aug 17 Consulting slot).
      if (!v || v.skipped || !v.note) return;
      out.push({ key: keyFor('sched', date), kind: 'sched', date: date,
                 themeId: v.themeId || '', text: v.note, trustLine: v.trustLine || '',
                 tagline: ('tagline' in v) ? v.tagline : undefined,
                 image: v.image || '', imageMeta: v.imageMeta || null });
    });
    ((state && state.triggeredEvents) || []).forEach(function (e, i) {
      var text = (e.note && e.note.trim()) ? e.note : (e.trustLine || '');
      var trust = (e.note && e.note.trim()) ? (e.trustLine || '') : '';
      // A placeholder event with no content is not a post yet: nothing to check,
      // and never blessed by a baseline, so its future content is governed as
      // new work the moment it is written (Paul's welcome, 2026-08-18).
      if (!String(text).trim()) return;
      out.push({ key: keyFor('event', e.date, e.id || i), kind: 'event', date: e.date,
                 themeId: e.themeId || '', text: text, trustLine: trust,
                 tagline: ('tagline' in e) ? e.tagline : undefined,
                 image: e.image || '', imageMeta: e.imageMeta || null });
    });
    return out;
  }

  /* baseline: { keys: { key: fingerprint } } captured at go-live.
     Returns [{ post, scope, changed }] where scope is enforce | advise | silent. */
  function resolve(proposalState, baseline) {
    var base = (baseline && baseline.keys) || {};
    return postsFrom(proposalState).map(function (p) {
      var known = Object.prototype.hasOwnProperty.call(base, p.key);
      if (!known) return { post: p, scope: 'enforce', changed: true, legacy: false };
      var changed = base[p.key] !== fingerprint(p);
      return { post: p, scope: changed ? 'advise' : 'silent', changed: changed, legacy: true };
    });
  }

  /* Stable identity + fingerprint for a division lane post, shared by the
     baseline build and the gate UI so grandfathering means the same thing on
     both sides (lanes joined the baseline 2026-08-18; before that every lane
     post was hardcoded as governed, which re-blocked published lane work). */
  function laneKey(laneId, postId) { return 'lane|' + laneId + '|' + postId; }
  function laneFingerprint(p) {
    return fingerprint({ text: p.note || '', trustLine: p.trustLine || '', themeId: '' });
  }

  /* Builds the frozen baseline from the state that is live at go-live. */
  function buildBaseline(liveState, label) {
    var keys = {};
    postsFrom(liveState).forEach(function (p) { keys[p.key] = fingerprint(p); });
    var lanes = (liveState && liveState.lanes) || {};
    Object.keys(lanes).forEach(function (id) {
      (((lanes[id] || {}).posts) || []).forEach(function (p) {
        keys[laneKey(id, p.id)] = laneFingerprint(p);
      });
    });
    return { label: label || 'go-live', createdAt: new Date().toISOString(),
             count: Object.keys(keys).length, keys: keys };
  }

  /* Applies scope to a set of gate findings.
     enforce -> unchanged. advise -> every BLOCK demoted to ADVISE (never blocks).
     silent  -> dropped. */
  function applyScope(items, scope) {
    if (scope === 'silent') return [];
    if (scope === 'advise') {
      return items.map(function (i) {
        return i.level === 'BLOCK'
          ? Object.assign({}, i, { level: 'ADVISE', legacyNote:
              'This post pre-dates the brand gate, so it does not block submission. Worth fixing while you are in here.' })
          : i;
      });
    }
    return items;
  }

  function canSubmit(allItems) {
    return !allItems.some(function (i) { return i.level === 'BLOCK'; });
  }


  /* Per-post publish partitioning (2026-08-18). The gate exists to hold back
     ONE broken post, never to freeze everyone else's clean work behind it.
     This computes exactly what a candidate state CHANGES relative to what is
     actually live right now, key by key (parent slot / event / lane post),
     independent of the merge machinery above, so the publish path can gate
     each change on its own instead of accepting or refusing the whole batch. */

  function keyedItem(kind, key, date, obj) {
    return { kind: kind, key: key, date: date, obj: obj || null };
  }

  /* Every addressable content unit in a state, keyed the same way postsFrom
     keys parent content plus lane posts, but keeping the raw object (not the
     gate-shaped post) so the caller can rebuild a filtered state from it. */
  function allKeyedUnits(state) {
    var out = {};
    var so = (state && state.slotOverrides) || {};
    Object.keys(so).forEach(function (date) {
      out[keyFor('sched', date)] = keyedItem('sched', keyFor('sched', date), date, so[date]);
    });
    ((state && state.triggeredEvents) || []).forEach(function (e, i) {
      var k = keyFor('event', e.date, e.id || i);
      out[k] = keyedItem('event', k, e.date, e);
    });
    var lanes = (state && state.lanes) || {};
    Object.keys(lanes).forEach(function (laneId) {
      (((lanes[laneId] || {}).posts) || []).forEach(function (p) {
        var k = 'lane|' + laneId + '|' + p.id;
        out[k] = keyedItem('lane', k, p.date, p);
        out[k].laneId = laneId;
      });
    });
    return out;
  }

  function unitFingerprint(unit) {
    if (!unit || !unit.obj) return '';
    if (unit.kind === 'lane') return laneFingerprint(unit.obj);
    var o = unit.obj;
    return fingerprint({ text: o.note, trustLine: o.trustLine, themeId: o.themeId })
      + '||' + (o.tagline || '') + '||' + (o.image || '') + '||' + !!o.skipped;
  }

  /* candidate vs live: every key where the fingerprint differs, keyed so the
     caller can gate each one and rebuild a filtered state from the result. */
  function diffAgainstLive(candidate, live) {
    var a = allKeyedUnits(live), b = allKeyedUnits(candidate);
    var keys = {};
    Object.keys(a).forEach(function (k) { keys[k] = 1; });
    Object.keys(b).forEach(function (k) { keys[k] = 1; });
    var changes = [];
    Object.keys(keys).forEach(function (k) {
      var liveU = a[k], candU = b[k];
      var liveFp = unitFingerprint(liveU), candFp = unitFingerprint(candU);
      if (liveFp === candFp) return;
      changes.push({
        key: k,
        kind: (candU || liveU).kind,
        laneId: (candU || liveU).laneId,
        date: (candU || liveU).date,
        removed: !candU || !candU.obj || (candU.kind === 'sched' && candU.obj.skipped),
        live: liveU,
        candidate: candU
      });
    });
    return changes;
  }

  /* Rebuilds a state that starts from `live` and applies ONLY the changes
     whose key is in `passKeys` (a Set or plain object of keys). Removals pass
     through unconditionally: taking something down is never a brand risk. */
  function applySelectedChanges(live, changes, passKeys) {
    var out = fbCloneLike(live);
    if (!out.slotOverrides) out.slotOverrides = {};
    if (!out.triggeredEvents) out.triggeredEvents = [];
    if (!out.lanes) out.lanes = {};
    changes.forEach(function (c) {
      var allowed = c.removed || (passKeys && (passKeys.has ? passKeys.has(c.key) : passKeys[c.key]));
      if (!allowed) return;
      if (c.kind === 'sched') {
        if (!c.candidate || !c.candidate.obj) delete out.slotOverrides[c.date];
        else out.slotOverrides[c.date] = fbCloneLike(c.candidate.obj);
      } else if (c.kind === 'event') {
        var id = c.key.split('|')[2];
        out.triggeredEvents = out.triggeredEvents.filter(function (e) { return (e.id || '') !== id; });
        if (c.candidate && c.candidate.obj) out.triggeredEvents.push(fbCloneLike(c.candidate.obj));
      } else if (c.kind === 'lane') {
        var laneId = c.laneId;
        if (!out.lanes[laneId]) out.lanes[laneId] = { posts: [] };
        var pid = c.key.split('|')[2];
        out.lanes[laneId].posts = (out.lanes[laneId].posts || []).filter(function (p) { return p.id !== pid; });
        if (c.candidate && c.candidate.obj) out.lanes[laneId].posts.push(fbCloneLike(c.candidate.obj));
      }
    });
    return out;
  }

  function fbCloneLike(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

  root.U1Scope = { resolve: resolve, buildBaseline: buildBaseline, applyScope: applyScope,
                   canSubmit: canSubmit, postsFrom: postsFrom, fingerprint: fingerprint,
                   laneKey: laneKey, laneFingerprint: laneFingerprint,
                   diffAgainstLive: diffAgainstLive, applySelectedChanges: applySelectedChanges };
})(typeof window !== 'undefined' ? window : globalThis);
