// Two editors, one post: the collision the merge cannot see.
//
// mergeOntoLive is base-relative and correct, which is why a draft fifty
// versions behind publishes nothing. But at the leaf it takes the editor's
// version whenever they changed something, without asking whether live moved
// away from their base meanwhile. Two people on the same post therefore ends
// with the second publish silently overwriting the first, and nothing anywhere
// says so.
//
// Detection sits beside the merge rather than inside it: the merge is covered
// by merge_test and is right for every other case, and what to do about a
// collision is a person's call.
//
// Run: node conflict_test.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const w = {};
new Function('window', readFileSync(join(here, 'u1_scope.js'), 'utf8'))(w);
const { conflictsAgainstLive } = w.U1Scope;

// The real merge, pulled from the shipping app, so this suite compares
// detection against what actually happens rather than against a description.
const lines = readFileSync(join(here, 'u1_calendar_interactive.html'), 'utf8').split('\n');
const s = lines.findIndex((l) => /^var MERGE_VIEW_KEYS/.test(l));
let e = lines.findIndex((l, i) => i >= s && l.startsWith('function mergeOntoLive'));
let d = 0;
for (let j = e; j < lines.length; j++) {
  d += (lines[j].match(/{/g) || []).length - (lines[j].match(/}/g) || []).length;
  if (d === 0 && j > e) { e = j; break; }
}
const M = {};
new Function('exports', 'function fbClone(o){return JSON.parse(JSON.stringify(o));}\n'
  + lines.slice(s, e + 1).join('\n') + '\nexports.mergeOntoLive = mergeOntoLive;')(M);

let pass = 0, fail = 0;
const t = (n, c) => { c ? (pass++, console.log('PASS  ' + n)) : (fail++, console.log('FAIL  ' + n)); };

const SIG = "We don't overpromise. We overdeliver.";
const post = (n) => ({ note: n + ' ' + SIG, trustLine: 'Safety', themeId: 't1',
                       image: 'x', imageMeta: { w: 1200, h: 800 } });
const st = (slots) => ({ slotOverrides: slots, triggeredEvents: [], lanes: {} });

// --- the collision ----------------------------------------------------------
const base     = st({ '2026-09-10': post('Original.'), '2026-09-11': post('Untouched.') });
const cristina = st({ '2026-09-10': post('Cristina rewrote this.'), '2026-09-11': post('Untouched.') });
const andrei   = st({ '2026-09-10': post('Andrei rewrote this.'),   '2026-09-11': post('Untouched.') });

const liveAfterCristina = M.mergeOntoLive(base, base, cristina);
const c = conflictsAgainstLive(liveAfterCristina, base, andrei);

t('the collision is detected', c.length === 1);
t('it names the post, not the field', c[0] && c[0].key === 'sched|2026-09-10');
t('it carries the date a person recognises', c[0] && c[0].date === '2026-09-10');
t('it keeps what is live, to show them', c[0] && /Cristina rewrote/.test(c[0].live.obj.note));
t('and what the editor wrote', c[0] && /Andrei rewrote/.test(c[0].edited.obj.note));
t('and the common ancestor', c[0] && /Original/.test(c[0].base.obj.note));
t('the untouched post is not reported', !c.some((x) => x.key === 'sched|2026-09-11'));

// The merge still does what it did. Detection changed nothing.
const merged = M.mergeOntoLive(liveAfterCristina, base, andrei);
t('the merge is unchanged, still last-writer-wins',
  /Andrei rewrote/.test(merged.slotOverrides['2026-09-10'].note));

// --- what must NOT be reported ---------------------------------------------
t('an editor who changed nothing has no conflict',
  conflictsAgainstLive(liveAfterCristina, base, base).length === 0);
t('editing a post nobody else touched is not a conflict',
  conflictsAgainstLive(base, base, st({ '2026-09-10': post('Original.'), '2026-09-11': post('Mine now.') })).length === 0);
t('both making the SAME edit is not a conflict',
  conflictsAgainstLive(M.mergeOntoLive(base, base, cristina), base, cristina).length === 0);
t('a draft far behind with no edits reports nothing',
  conflictsAgainstLive(st({ '2026-12-01': post('Much later live.') }), base, base).length === 0);

// --- removals, which are the expensive kind --------------------------------
const cristinaDeleted = st({ '2026-09-11': post('Untouched.') });
const liveAfterDelete = M.mergeOntoLive(base, base, cristinaDeleted);
const c2 = conflictsAgainstLive(liveAfterDelete, base, andrei);
t('editing a post someone else deleted is a conflict', c2.length === 1);
t('and it says live removed it', c2[0] && c2[0].liveRemoved === true);

const c3 = conflictsAgainstLive(liveAfterCristina, base, cristinaDeleted);
t('deleting a post someone else edited is a conflict', c3.length === 1);
t('and it says the editor removed it', c3[0] && c3[0].editorRemoved === true);

// --- shape --------------------------------------------------------------
t('missing states do not throw', conflictsAgainstLive(null, null, null).length === 0);
t('key order does not invent conflicts',
  conflictsAgainstLive(
    st({ '2026-09-10': { note: 'x ' + SIG, themeId: 't1', trustLine: 'S', image: 'i', imageMeta: { w: 1, h: 2 } } }),
    st({ '2026-09-10': { themeId: 't1', note: 'x ' + SIG, imageMeta: { h: 2, w: 1 }, image: 'i', trustLine: 'S' } }),
    st({ '2026-09-10': { image: 'i', note: 'x ' + SIG, trustLine: 'S', imageMeta: { w: 1, h: 2 }, themeId: 't1' } })
  ).length === 0);


// --- the message the owner actually reads -----------------------------------
// conflictWarning lives inside the proposals snapshot callback, beside pushIt,
// so it cannot be reached from the console. Extracted here the same way the
// other suites pull mergeOntoLive out of the app, so this tests the shipping
// text rather than a copy of it.
const appSrc = readFileSync(join(here, 'u1_calendar_interactive.html'), 'utf8');
const cwStart = appSrc.indexOf('var conflictWarning = function (d) {');
const cwEnd = appSrc.indexOf('\n    };', cwStart) + '\n    };'.length;
const W = {};
new Function('exports', 'window',
  appSrc.slice(cwStart, cwEnd) + '\nexports.conflictWarning = conflictWarning;')(W, w);

w.__liveState = liveAfterCristina;
const msg = W.conflictWarning({ baseState: base, state: andrei });
t('the owner is shown a warning at all', msg.length > 0);
t('it leads with the word CONFLICT', /^CONFLICT: /.test(msg));
t('it names the date', /2026-09-10/.test(msg));
t('it says which way the publish resolves', /discards the live version/.test(msg));
t('a clean draft produces no warning at all',
  W.conflictWarning({ baseState: base, state: base }) === '');

// A deletion is the expensive one, because the gate never holds removals.
w.__liveState = liveAfterCristina;
t('a deletion of an edited post is called out in capitals',
  /THIS DRAFT DELETES IT/.test(W.conflictWarning({ baseState: base, state: cristinaDeleted })));

// If the scope layer is missing the publish must not break.
const noScope = {};
new Function('exports', 'window', appSrc.slice(cwStart, cwEnd) + '\nexports.conflictWarning = conflictWarning;')(noScope, {});
t('a missing U1Scope degrades to no warning rather than a broken publish',
  noScope.conflictWarning({ baseState: base, state: andrei }) === '');

// --- both publish routes are wired, including the escape hatch --------------
t('the normal publish route shows it',
  /if \(confirm\(conflictWarning\(d\) \+ \(stale \?/.test(appSrc));
t('"publish anyway" cannot be the quiet way past it',
  /if \(confirm\(conflictWarning\(d\) \+ who \+ ' has NOT submitted/.test(appSrc));
t('U1Scope exports the detector for the app to reach',
  /conflictsAgainstLive: conflictsAgainstLive/.test(readFileSync(join(here, 'u1_scope.js'), 'utf8')));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
