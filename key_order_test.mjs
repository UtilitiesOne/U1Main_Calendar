// Regression for the 2026-08-28 silent-revert incident.
//
// Firestore stores map fields unordered and returns them in arbitrary order, so
// the same imageMeta arrives as {h,bytes,w} on one read and {bytes,w,h} on the
// next. sameJson compared with JSON.stringify, which is order-sensitive, so
// identical data read as an edit and the merge republished the editor's copy
// over whatever was live.
//
// Measured cost before the fix: eight silent reverts between v45 and v64, two
// editors overwriting each other on the same two posts for ten days, nobody
// told. Reproduced against the real production proposal: as-is the merge
// produced 962 chars (matching live v64), key-sorted it preserved the 650-char
// version that was actually current.
//
// Run: node key_order_test.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const APP = join(here, 'u1_calendar_interactive.html');

// Pull the merge straight out of the app, so this suite always tests the
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

const mergeSrc = 'function fbClone(o) { return JSON.parse(JSON.stringify(o)); }\n'
  + extractFromApp(APP, /^var MERGE_VIEW_KEYS/, 'mergeOntoLive')
  + '\nexports.mergeOntoLive = mergeOntoLive;'
  + '\nexports.sameJson = sameJson;'
  + '\nexports.stableJson = stableJson;';
const M = {};
new Function('exports', mergeSrc)(M);
const { mergeOntoLive, sameJson, stableJson } = M;

let pass = 0, fail = 0;
function t(name, cond) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); } }

// --- the helper itself ------------------------------------------------------
t('same values, different key order, are equal',
  sameJson({ h: 4031, bytes: 3254231, w: 3023 }, { bytes: 3254231, w: 3023, h: 4031 }));
t('different values are still different', !sameJson({ a: 1 }, { a: 2 }));
t('nested key order is ignored too', sameJson({ x: { p: 1, q: 2 } }, { x: { q: 2, p: 1 } }));
t('array ORDER still matters (posts are ordered)', !sameJson([1, 2], [2, 1]));
t('missing key is not equal to present key', !sameJson({ a: 1 }, { a: 1, b: 2 }));
t('null is not zero', sameJson({ a: null }, { a: null }) && !sameJson({ a: null }, { a: 0 }));
t('stableJson is deterministic for the same input',
  stableJson({ b: 1, a: 2 }) === stableJson({ a: 2, b: 1 }));

// --- the incident, in miniature ---------------------------------------------
const SIG = "We don't overpromise. We overdeliver.";
const IMG = 'https://firebasestorage.googleapis.com/v0/b/u1-calendar.firebasestorage.app/o/x.png?alt=media';

// The editor's base and their draft hold the SAME post; only the imageMeta key
// order differs, because the two copies came back from Firestore on different
// reads. That alone used to count as an edit.
const post = (note, metaOrder) => ({
  note, trustLine: 'Safety', themeId: 't1', image: IMG,
  imageMeta: metaOrder === 'a' ? { h: 800, bytes: 1000, w: 1200 } : { bytes: 1000, w: 1200, h: 800 }
});

const base = { slotOverrides: { '2026-08-26': post('Andrei original. ' + SIG + ' #UtilitiesOne', 'a'),
                                '2026-09-05': post('Untouched. ' + SIG + ' #UtilitiesOne', 'a') } };
// Someone else republished that slot while this draft sat open.
const live = { slotOverrides: { '2026-08-26': post('Cristina rewrite. ' + SIG + ' #UtilitiesOne', 'a'),
                                '2026-09-05': post('Untouched. ' + SIG + ' #UtilitiesOne', 'a') } };
// The editor changed only 2026-09-05. 2026-08-26 is untouched, just re-serialised.
const edited = { slotOverrides: { '2026-08-26': post('Andrei original. ' + SIG + ' #UtilitiesOne', 'b'),
                                  '2026-09-05': post('Andrei edited this one. ' + SIG + ' #UtilitiesOne', 'a') } };

const merged = mergeOntoLive(live, base, edited);
const at = (d) => merged.slotOverrides[d].note;

t("the untouched slot keeps the OTHER editor's live version",
  at('2026-08-26').startsWith('Cristina rewrite'));
t("the genuinely edited slot takes the editor's version",
  at('2026-09-05').startsWith('Andrei edited this one'));

// --- the guard that stops it coming back ------------------------------------
const appSrc = readFileSync(APP, 'utf8');
t('sameJson no longer compares raw JSON.stringify',
  !/function sameJson\(a, b\) \{ return JSON\.stringify\(a\) === JSON\.stringify\(b\); \}/.test(appSrc));
t('contentFingerprint is order-independent too (it guards submission retraction)',
  /return stableJson\(copy\);/.test(appSrc));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
