// The stale-findings contract, held on BOTH calendars' panels so the forks
// cannot drift. A review describes the draft at the last submit; the panel
// must say so when the editor has saved changes since, and must never cry
// stale on a fresh check or on a review with no timestamp.
// Run: node panel_stale_test.mjs
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
// U1's panel is the one sitting next to this file, so the suite always tests the
// copy that ships. It used to point at C:/tmp/u1cal_check, a temp checkout nobody
// maintains: the content happened to still match, but nothing kept it matching,
// and a green run would have meant nothing the day it drifted.
//
// E5's panel lives in a sibling of the mirror and is simply absent from the
// calendar repo. Absent means SKIP with a line saying so, not a crash. The crash
// used to kill the run after eleven U1 cases had already passed, which is why
// this suite was written off as "does not run on this machine".
const PANELS = [
  ['U1', process.env.U1_PANEL_PATH || join(here, 'u1_review_panel.js'), 'U1ReviewPanel'],
  ['E5', process.env.E5_PANEL_PATH || resolve(here, '..', '2026-08-19_e5_calendar', 'app', 'e5_review_panel.js'), 'E5ReviewPanel']
];

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name); }
}
const ts = (sec) => ({ seconds: sec });

let skipped = 0;
for (const [label, path, globalName] of PANELS) {
  if (!existsSync(path)) {
    console.log('SKIP  ' + label + ': no panel at ' + path);
    skipped++;
    continue;
  }
  // The panel returns early when there is no DOM, exposing the pure helpers only.
  const g = {};
  new Function('globalThis', 'window', 'document', readFileSync(path, 'utf8'))(g, undefined, undefined);
  const api = g[globalName];
  t(label + ': panel loads in node and exports its helpers', !!(api && typeof api.isStale === 'function'));
  const isStale = api.isStale;

  // The submit path writes the proposal FIRST and the review LAST, so a fresh
  // check always has review.at >= proposal.updatedAt.
  t(label + ': fresh check is never stale (review written after the save)',
    isStale(ts(1000), ts(998)) === false);
  t(label + ': same-second writes are not stale',
    isStale(ts(1000), ts(1000)) === false);
  t(label + ': write skew inside tolerance is not stale',
    isStale(ts(1000), ts(1002)) === false);

  // A real post-review edit: the editor fixed something and saved.
  t(label + ': an edit minutes after the check is stale',
    isStale(ts(1000), ts(1300)) === true);
  t(label + ': an edit just past tolerance is stale',
    isStale(ts(1000), ts(1003)) === true);

  // No timestamps, no claim: never invent staleness we cannot prove.
  t(label + ': missing proposal timestamp is not stale', isStale(ts(1000), null) === false);
  t(label + ': missing review timestamp is not stale', isStale(null, ts(1000)) === false);
  t(label + ': both missing is not stale', isStale(null, null) === false);
  t(label + ': undefined inputs are not stale', isStale(undefined, undefined) === false);

  // Tolerance is a parameter, and the default is the documented 2 seconds.
  t(label + ': explicit tolerance is honoured', isStale(ts(1000), ts(1030), 60) === false);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed' + (skipped ? ', ' + skipped + ' panel(s) skipped, not present here' : ''));
process.exit(fail ? 1 : 0);
