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
      if (!v || !v.note) return;
      out.push({ key: keyFor('sched', date), kind: 'sched', date: date,
                 themeId: v.themeId || '', text: v.note, trustLine: v.trustLine || '',
                 tagline: ('tagline' in v) ? v.tagline : undefined });
    });
    ((state && state.triggeredEvents) || []).forEach(function (e, i) {
      var text = (e.note && e.note.trim()) ? e.note : (e.trustLine || '');
      var trust = (e.note && e.note.trim()) ? (e.trustLine || '') : '';
      out.push({ key: keyFor('event', e.date, e.id || i), kind: 'event', date: e.date,
                 themeId: e.themeId || '', text: text, trustLine: trust,
                 tagline: ('tagline' in e) ? e.tagline : undefined });
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

  /* Builds the frozen baseline from the state that is live at go-live. */
  function buildBaseline(liveState, label) {
    var keys = {};
    postsFrom(liveState).forEach(function (p) { keys[p.key] = fingerprint(p); });
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

  root.U1Scope = { resolve: resolve, buildBaseline: buildBaseline, applyScope: applyScope,
                   canSubmit: canSubmit, postsFrom: postsFrom, fingerprint: fingerprint };
})(typeof window !== 'undefined' ? window : globalThis);
