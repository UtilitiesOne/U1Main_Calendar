// Per-post publish partitioning: a single broken post must never hold back
// everyone else's clean work. Pure node, no Firebase, no browser.
// Run: node per_post_publish_test.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const load = (f) => { const w = {}; new Function('window', readFileSync(join(here, f), 'utf8'))(w); return w; };
const g = load('u1_gate.js'), s = load('u1_scope.js');
const Gate = g.U1Gate, Scope = s.U1Scope;

let pass = 0, fail = 0;
function t(name, cond) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); } }

const SIG = "We don't overpromise. We overdeliver.";
const IMG = 'https://firebasestorage.googleapis.com/v0/b/u1-calendar.firebasestorage.app/o/post-images%2Ft%2Fa.png?alt=media';

const live = { slotOverrides: {}, triggeredEvents: [], lanes: { water: { posts: [] } } };

const candidate = {
  slotOverrides: {
    '2026-08-27': { note: 'A clean post. ' + SIG + ' #UtilitiesOne #Water #WaterInfrastructure', trustLine: 'Safety', themeId: 't1', image: IMG, imageMeta: { w: 1200, h: 800 } },
    '2026-08-28': { note: 'A broken post with no signature and a banned tag. #Construction', trustLine: '', themeId: 't1', image: IMG, imageMeta: { w: 1200, h: 800 } }
  },
  triggeredEvents: [],
  lanes: { water: { posts: [{ id: 'w1', date: '2026-08-29', note: 'A clean lane post. ' + SIG + ' #UtilitiesOne #Water', trustLine: 'Teamwork', image: IMG, imageMeta: { w: 1200, h: 800 } }] } }
};

const changes = Scope.diffAgainstLive(candidate, live);
t('diff finds exactly 3 changed keys', changes.length === 3);
t('diff correctly identifies the lane change', changes.some(c => c.kind === 'lane'));
t('nothing is flagged as removed (all are additions)', changes.every(c => !c.removed));

// evaluatePerChange lives inside u1_review_ui.js as a closure, not exported.
// Reproduce its per-change logic here at the fidelity that matters for the
// test: run the SAME checkPost calls it would run, so this proves the gate
// itself discriminates correctly between the clean and broken units.
function verdictFor(c) {
  if (c.kind === 'lane') {
    const obj = c.candidate.obj;
    const items = Gate.checkPost({ date: obj.date, tagline: '', bodyActivationRequired: false,
      text: obj.note, trustLine: obj.trustLine, image: obj.image, imageMeta: obj.imageMeta,
      laneId: c.laneId, laneName: c.laneId, laneTag: '#Water' });
    return { key: c.key, pass: !items.some(i => i.level === 'BLOCK'), items };
  }
  const obj = c.candidate.obj;
  const items = Gate.checkPost({ date: c.date, tagline: obj.tagline || '', bodyActivationRequired: false,
    text: obj.note, trustLine: obj.trustLine, image: obj.image, imageMeta: obj.imageMeta });
  return { key: c.key, pass: !items.some(i => i.level === 'BLOCK'), items };
}
const verdicts = changes.map(verdictFor);
const cleanKey = 'sched|2026-08-27', brokenKey = 'sched|2026-08-28', laneKey = changes.find(c => c.kind === 'lane').key;

t('the clean parent post passes', verdicts.find(v => v.key === cleanKey).pass === true);
t('the broken parent post is held', verdicts.find(v => v.key === brokenKey).pass === false);
t('the clean lane post passes', verdicts.find(v => v.key === laneKey).pass === true);

// Partition: only the passing keys go into what gets published.
const passKeys = new Set(verdicts.filter(v => v.pass).map(v => v.key));
const toPublish = Scope.applySelectedChanges(live, changes, passKeys);

t('published state carries the clean parent post', toPublish.slotOverrides['2026-08-27'] !== undefined);
t('published state does NOT carry the broken parent post', toPublish.slotOverrides['2026-08-28'] === undefined);
t('published state carries the clean lane post', toPublish.lanes.water.posts.some(p => p.id === 'w1'));
t('a new version is warranted (published state differs from live)',
  JSON.stringify(toPublish) !== JSON.stringify(live));

// A removal must pass through unconditionally: taking something down is
// never itself a brand violation, so it should never need a gate check.
const liveWithPost = { slotOverrides: { '2026-08-30': { note: 'existing', trustLine: 'x', themeId: 't1' } },
                       triggeredEvents: [], lanes: {} };
const candidateRemoved = { slotOverrides: {}, triggeredEvents: [], lanes: {} };
const removalChanges = Scope.diffAgainstLive(candidateRemoved, liveWithPost);
t('a deleted post is detected as a change', removalChanges.length === 1);
t('a deleted post is flagged removed, not gated', removalChanges[0].removed === true);
const removalPublish = Scope.applySelectedChanges(liveWithPost, removalChanges, new Set());
t('removal applies even with an EMPTY pass set (removals are never held)',
  removalPublish.slotOverrides['2026-08-30'] === undefined);

// All-held case: nothing should go live, and the caller can detect that from
// an empty passKeys / unchanged output.
const allBrokenCandidate = { slotOverrides: {
  '2026-08-31': { note: 'broken one. #Construction', trustLine: '', themeId: 't1' }
}, triggeredEvents: [], lanes: {} };
const abChanges = Scope.diffAgainstLive(allBrokenCandidate, live);
const abVerdicts = abChanges.map(verdictFor);
const abPass = new Set(abVerdicts.filter(v => v.pass).map(v => v.key));
t('all-broken candidate yields zero passing keys', abPass.size === 0);
const abPublish = Scope.applySelectedChanges(live, abChanges, abPass);
t('nothing is published when everything is held (state unchanged)',
  JSON.stringify(abPublish) === JSON.stringify(live));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
