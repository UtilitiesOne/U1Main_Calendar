// A changed script that keeps its old ?v= never reaches anyone.
//
// The page loads its JS with cache-busting query strings. Change a file and
// leave the string alone and every returning browser keeps serving the old copy
// from cache, so the fix ships to the repo and to nobody's screen.
//
// Caught 2026-09-01, on my own work: u1_scope.js, u1_review_ui.js and
// u1_review_panel.js were all edited across a day of commits and not one of the
// three versions was bumped. The conflict detector was on origin, on Pages, and
// absent from the running page.
//
// This cannot tell whether a file changed since the last release, which would
// need release state the repo does not keep. What it can do is refuse the two
// mistakes that are actually easy to make: a script the page loads with no
// version at all, and a version the file itself contradicts.
//
// Run: node cache_bust_test.mjs
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(here, 'u1_calendar_interactive.html'), 'utf8');
let pass = 0, fail = 0;
const t = (n, c) => { c ? (pass++, console.log('PASS  ' + n)) : (fail++, console.log('FAIL  ' + n)); };

const tags = [...app.matchAll(/<script src="(u1_[a-z_]+\.js)(\?v=([0-9.]+))?"/g)]
  .map((m) => ({ file: m[1], v: m[3] || null }));

t('the page still loads its local scripts', tags.length >= 5);

for (const { file, v } of tags) {
  t(file + ' is loaded with a version string', !!v);
  t(file + ' exists in the repo', existsSync(join(here, file)));
}

// The review panel prints its version on screen. If the tag and the file
// disagree, the number a person reads is not the code they are running, which
// is worse than showing nothing.
const panel = readFileSync(join(here, 'u1_review_panel.js'), 'utf8');
const declared = (panel.match(/PANEL_VERSION\s*=\s*["']([0-9.]+)["']/) || [])[1];
const tagged = (tags.find((x) => x.file === 'u1_review_panel.js') || {}).v;
t('the panel version it prints matches the version the page requests (' +
  declared + ' vs ' + tagged + ')', declared === tagged);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
