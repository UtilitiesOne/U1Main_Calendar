// Failures a person can actually see.
//
// Eleven catch blocks swallowed completely. Four of them mattered and are fixed
// here; the other seven wrap teardown unsubscribes and listener attachment,
// where silence is the right answer and this suite asserts it stays silent.
//
// The one that mattered most: ticking a review finding off updated the screen,
// then console.warn'd into a log nobody has open if the write failed, inside an
// outer catch that swallowed even that. The reviewer saw it ticked, moved on,
// and the finding stayed open for whoever read the review next.
//
// A note on how the saveState fix was arrived at, because the code read fine and
// was still wrong: the first version called U1Notice on failure, but the first
// failure lands during page load, before u1_review_ui.js has defined U1Notice,
// so it fell through to alert() and vanished. Only breaking localStorage in a
// real browser showed that. Delivery is deferred now. Reading the source would
// not have caught it, which is the whole point of running the thing.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
// Resolve next to this file. Three suites were found on 2026-09-01 reading a
// stale copy somewhere else and passing against code that does not ship, so no
// suite in this repo hardcodes a path any more.
const R = dirname(fileURLToPath(import.meta.url)) + '/';
let pass = 0, fail = 0;
const t = (n, c) => { c ? (pass++, console.log('PASS  ' + n)) : (fail++, console.log('FAIL  ' + n)); };

// --- 1. the tick that could not be saved -----------------------------------
const panel = readFileSync(R + 'u1_review_panel.js', 'utf8');
t('tick: no bare swallow left in the handler',
  !/\.catch\(function \(e\) \{ console\.warn\('tick not saved/.test(panel));
t('tick: failure reverts the model', /rev\.items\[g\]\.findings\[f\]\.done = was;/.test(panel));
t('tick: failure reverts the checkbox', /cb\.checked = was;/.test(panel));
t('tick: the state it reverts to is captured before the write, not read back later',
  /var was = !cb\.checked;/.test(panel) && panel.indexOf('var was = !cb.checked;') < panel.indexOf('var revert ='));
t('tick: the panel says so on screen', /STATE\.status = 'a tick could not be saved/.test(panel));
t('tick: and the user gets a notice', /U1Notice\('That tick was not saved/.test(panel));
t('tick: a throw takes the same path as a rejection',
  /catch \(e\) \{ revert\(/.test(panel));

// --- 2. the notice channel exists at load ----------------------------------
const w = {};
new Function('window', 'document', 'firebase', readFileSync(R + 'u1_review_ui.js', 'utf8'))(w, undefined, undefined);
t('notice: U1Notice is a function immediately after load, not after a publish',
  typeof w.U1Notice === 'function');

// --- 3. saveState ----------------------------------------------------------
const app = readFileSync(R + 'u1_calendar_interactive.html', 'utf8');
t('saveState: no longer an empty catch', !/localStorage\.setItem\(BRAND_CONFIG\.storageKey, JSON\.stringify\(state\)\); \}\r?\n\s*catch \(e\) \{\}/.test(app));
t('saveState: warns once, not on every keystroke', /window\.__localSaveWarned = true;/.test(app));
t('saveState: tells a signed-out user their work is not being kept',
  /Nothing is being saved on this device/.test(app));
t('saveState: waits for the notice channel instead of firing before it exists',
  /if \(typeof window\.U1Notice === 'function'\) \{ window\.U1Notice\(m\); return; \}/.test(app)
  && /setTimeout\(deliver, 250\);/.test(app));
t('saveState: still falls back to alert if the channel never appears',
  /if \(\+\+tries > 20\) \{ alert\(m\); return; \}/.test(app));

// --- 4. degraded checks are now diagnosable --------------------------------
t('theme map: an empty map is reported, not swallowed',
  /gate checks are degraded/.test(readFileSync(R + 'u1_review_ui.js', 'utf8')));
t('rules version: unreadable version is reported',
  /staleness check degraded/.test(panel));
t('rules version: verdict deliberately unchanged (no false staleness storm)',
  /return !!\(cur && reviewRulesVersion && reviewRulesVersion !== cur\);/.test(panel));

// --- 5. the catches that SHOULD stay silent are still silent ---------------
t('teardown unsubs are left alone, silence is correct there',
  (panel.match(/try \{ STATE\.punsub\(\); \} catch \(e\) \{\}/g) || []).length >= 1);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
