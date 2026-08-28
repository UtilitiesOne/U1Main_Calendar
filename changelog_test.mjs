// Changeset migration, step 1: the recorded change log.
//
// The property under test is the one the whole redesign turns on: a post the
// editor never touched must not appear in their change log, no matter what
// happened to live while they were drafting. The old publish path diffs the
// editor's photocopy against LIVE, so anything another editor published after
// this draft opened reads as a deletion. That is how a week-old draft came to
// hold three deletion orders for someone else's posts on 2026-08-28.
//
// The log is diffed against the editor's OWN base, which does not move.
//
// Run: node changelog_test.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const APP = join(here, 'u1_calendar_interactive.html');

// Pull the function straight out of the app, so this suite always tests the
// deployed code rather than a copy that can drift away from it.
function extractFromApp(appPath, startPattern, endFnName) {
  const lines = readFileSync(appPath, 'utf8').split('\n');
  const start = lines.findIndex((l) => startPattern.test(l));
  if (start < 0) throw new Error('start pattern not found: ' + startPattern);
  let end = lines.findIndex((l, i) => i >= start && l.startsWith('function ' + endFnName));
  if (end < 0) throw new Error('end function not found: ' + endFnName);
  let depth = 0;
  for (let j = end; j < lines.length; j++) {
    depth += (lines[j].match(/{/g) || []).length - (lines[j].match(/}/g) || []).length;
    if (depth === 0 && j > end) { end = j; break; }
  }
  return lines.slice(start, end + 1).join('\n');
}

// changeLogFromBase reads window.U1Scope, so stand the real scope engine up.
const g = globalThis;
g.window = g;
new Function('window', readFileSync(join(here, 'u1_scope.js'), 'utf8'))(g);

const src = 'var fb = {}, state = {};\n'
  + 'function setCtx(b, s) { fb = { baseState: b }; state = s; }\n'
  + extractFromApp(APP, /^function changeLogFromBase/, 'changeLogFromBase')
  + '\nexports.changeLogFromBase = changeLogFromBase;'
  + '\nexports.setCtx = setCtx;';
const C = {};
new Function('exports', 'window', src)(C, g);
const { changeLogFromBase, setCtx } = C;

let pass = 0, fail = 0;
function t(name, cond) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); } }

const SIG = "We don't overpromise. We overdeliver.";
const post = (note) => ({ note, trustLine: 'Safety', themeId: 't1', image: 'x', imageMeta: { w: 1200, h: 800 } });

// The editor loaded the calendar when it held two posts.
const base = {
  slotOverrides: { '2026-09-01': post('One. ' + SIG), '2026-09-02': post('Two. ' + SIG) },
  triggeredEvents: [], lanes: {}
};

// They rewrote one, added one, deleted one.
const edited = {
  slotOverrides: { '2026-09-01': post('One, rewritten by me. ' + SIG), '2026-09-03': post('Three, mine. ' + SIG) },
  triggeredEvents: [], lanes: {}
};

setCtx(base, edited);
const log = changeLogFromBase();
const byKey = Object.fromEntries((log || []).map((e) => [e.key, e]));

t('a log is produced', Array.isArray(log));
t('exactly three entries (edit, add, delete)', log.length === 3);
t('the edited post is an upsert', !!byKey['sched|2026-09-01'] && byKey['sched|2026-09-01'].action === 'upsert');
t('the edited post carries its new body',
  !!byKey['sched|2026-09-01'] && /rewritten by me/.test(byKey['sched|2026-09-01'].obj.note));
t('the new post is an upsert', !!byKey['sched|2026-09-03'] && byKey['sched|2026-09-03'].action === 'upsert');
t('the removed post is a delete', !!byKey['sched|2026-09-02'] && byKey['sched|2026-09-02'].action === 'delete');
t('a delete carries no object', !!byKey['sched|2026-09-02'] && byKey['sched|2026-09-02'].obj === null);

// --- the property that matters ---------------------------------------------
// Another editor publishes two posts while this draft sits open. Live moves;
// this editor's base and draft do not. Their log must not move either.
const liveMovedOn = {
  slotOverrides: {
    '2026-09-01': post('One. ' + SIG), '2026-09-02': post('Two. ' + SIG),
    '2026-09-10': post('Someone else, ten. ' + SIG), '2026-09-11': post('Someone else, eleven. ' + SIG)
  },
  triggeredEvents: [], lanes: {}
};
const logBefore = JSON.stringify(log);
setCtx(base, edited);
const logAfter = JSON.stringify(changeLogFromBase());
t('the log is stable regardless of what live is doing', logBefore === logAfter);
t("another editor's new posts appear nowhere in the log",
  !/2026-09-10|2026-09-11/.test(logAfter));

// And the contrast: the OLD approach, diffing this same draft against the moved
// live, invents deletions for both of those posts.
const oldWay = g.U1Scope.diffAgainstLive(edited, liveMovedOn);
t('the old live-diff would have invented deletions for them (this is the bug)',
  oldWay.filter((c) => c.removed && /2026-09-10|2026-09-11/.test(c.key)).length === 2);

// --- edges ------------------------------------------------------------------
setCtx(null, edited);
t('no base yields null rather than a bogus log', changeLogFromBase() === null);

setCtx(base, JSON.parse(JSON.stringify(base)));
const none = changeLogFromBase();
t('a draft nobody edited produces an empty log', Array.isArray(none) && none.length === 0);

setCtx(base, edited);
t('no undefined values (Firestore rejects them)',
  !JSON.stringify(changeLogFromBase()).includes('undefined'));

// --- step 1 is behaviour-neutral --------------------------------------------
const appSrc = readFileSync(APP, 'utf8');
t('the publish path still uses the old diff (nothing reads `changes` yet)',
  /window\.U1Scope\.diffAgainstLive\(candidateState, live\)/.test(readFileSync(join(here, 'u1_review_ui.js'), 'utf8')));
t('the log is written on save', /changes: changeLogFromBase\(\)/.test(appSrc));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
