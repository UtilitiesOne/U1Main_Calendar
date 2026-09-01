// Rebase regression. Pure node, no Firebase. Run: node merge_test.mjs
// Guards the defect found 2026-08-17: mergeOntoLive named the keys it merged, so
// every key added to the schema after it was written (lanes, the spotlight
// uplifts) was silently dropped when an editor's proposal was rebased onto live.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// The app next to this file, which is the one that ships.
//
// This pointed at C:/tmp/u1cal_check, a temp checkout last touched 2026-08-25.
// That copy predates the key-order fix: it has no stableJson at all, so it still
// carries the order-sensitive comparison that silently reverted eight posts over
// ten days. This suite covers the three-way merge, the exact logic that failed,
// and it was passing against the broken version the whole time. It proved
// nothing. Found 2026-09-01 when CI ran it on Linux and the Windows path did not
// exist, which is the only reason anyone noticed.
const appPath = process.env.U1_APP_PATH || join(dirname(fileURLToPath(import.meta.url)), 'u1_calendar_interactive.html');
const html = readFileSync(appPath, 'utf8');
const from = html.indexOf('var MERGE_VIEW_KEYS');
const to = html.indexOf('function subscribeVersions');
if (from < 0 || to < 0 || to <= from) {
  console.log('FAIL  could not locate the merge block in ' + appPath);
  process.exit(1);
}
const { mergeOntoLive } = new Function('fbClone',
  html.slice(from, to) + '\nreturn { mergeOntoLive: mergeOntoLive };')(
  o => JSON.parse(JSON.stringify(o)));

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name); }
}
const clone = o => JSON.parse(JSON.stringify(o));

const emptyLanes = () => ({
  powerdelivery: { posts: [] }, water: { posts: [] }, wireline: { posts: [] },
  wireless: { posts: [] }, renewable: { posts: [] }, datacenters: { posts: [] },
  fulfillment: { posts: [] }, consulting: { posts: [] }
});

const base = {
  view: 'grid', currentMonth: '2026-08', activeLane: 'parent',
  themes: { t1: { name: 'One' } },
  lanes: emptyLanes(),
  triggeredEvents: [{ id: 'e1', date: '2026-08-13', note: 'kept' }],
  slotOverrides: { '2026-08-19': { note: 'original 19th' }, '2026-08-21': { note: 'original 21st' } },
  spotlightOverrides: {},
  spot1Div: '', spot2Div: '', spot1Uplift: 2, spot2Uplift: 2
};

// Live has moved on: another editor published a lane post, a new day, and a theme change.
const live = clone(base);
live.view = 'review';
live.lanes.wireline.posts.push({ id: 'wl1', date: '2026-08-20', note: 'other editor' });
live.slotOverrides['2026-08-31'] = { note: 'added by someone else' };
live.themes.t1.name = 'One, renamed by someone else';
live.triggeredEvents.push({ id: 'e9', date: '2026-08-25', note: 'other editor event' });

// This editor's proposal, drafted from base.
const edited = clone(base);
edited.lanes.water.posts.push({ id: 'w1', date: '2026-08-22', note: 'my water post' });
edited.spot1Uplift = 5;
edited.slotOverrides['2026-08-19'] = { note: 'my rewrite of the 19th' };
delete edited.slotOverrides['2026-08-21'];
edited.triggeredEvents = [{ id: 'e1', date: '2026-08-13', note: 'kept' },
                          { id: 'e2', date: '2026-08-14', note: 'my new event' }];
edited.futureThing = { some: 'key added in a later release' };

const m = mergeOntoLive(live, base, edited);

// The defect this file exists for.
t('lane post from the editor survives the rebase',
  m.lanes.water.posts.length === 1 && m.lanes.water.posts[0].id === 'w1');
t('lane post already live from another editor survives',
  m.lanes.wireline.posts.length === 1 && m.lanes.wireline.posts[0].id === 'wl1');
t('spotlight uplift change survives', m.spot1Uplift === 5);
t('untouched uplift keeps its value', m.spot2Uplift === 2);

// Day-level semantics promised in the rebase confirmation.
t("editor's day wins on a same-day conflict",
  m.slotOverrides['2026-08-19'].note === 'my rewrite of the 19th');
t('day the editor deleted is removed', !('2026-08-21' in m.slotOverrides));
t('day added to live by someone else survives',
  m.slotOverrides['2026-08-31'].note === 'added by someone else');

// Id-keyed collections.
t('event added by the editor is carried',
  m.triggeredEvents.some(e => e.id === 'e2'));
t('event already live from another editor survives',
  m.triggeredEvents.some(e => e.id === 'e9'));
t('event untouched by the editor survives',
  m.triggeredEvents.some(e => e.id === 'e1'));

// Concurrent-editor safety: what this editor never touched must not be reverted.
t('key the editor left alone keeps the live value',
  m.themes.t1.name === 'One, renamed by someone else');

// View-local state belongs to the viewer, not the proposal.
t('view keys are not carried from the proposal',
  m.view === 'review' && m.activeLane === 'parent');

// The drift guard: a content key that did not exist when this merge was written.
t('unknown future content key is carried, not dropped',
  m.futureThing && m.futureThing.some === 'key added in a later release');

// Nothing the schema carries may vanish.
const lost = Object.keys(live).filter(k => !(k in m));
t('no live key disappears from the merged state (' + (lost.join(',') || 'none') + ')', lost.length === 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
