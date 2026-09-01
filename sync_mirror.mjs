// Keep the working copy in output/2026-08-07_u1_brand_gate in step with the repo.
//
// GitHub Pages serves this repo directly, so the repo is production and the other
// directory is a copy. It cannot simply be deleted: some suites need siblings
// that live over there, E5's review panel among them.
//
// It was kept in step by hand, which works until somebody forgets. On 2026-09-01
// it drifted within ten minutes of an edit. A copy that is usually right is worse
// than one that is obviously stale, because people trust it: two suites were
// found that same day reading stale copies of files that had moved on, both
// green, both proving nothing.
//
// CI cannot check this, since the mirror does not exist on a GitHub runner. So it
// is a local command that either reports drift or fixes it, and it only ever
// copies repo to mirror. The mirror must never be able to overwrite production.
//
//   node sync_mirror.mjs            report drift, change nothing
//   node sync_mirror.mjs --write    copy the repo over the mirror
//
// The path comes from U1_MIRROR or an argument, never hardcoded. This repo is
// public and one person's directory layout does not belong in it.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const write = args.includes('--write');
const mirror = args.find((a) => !a.startsWith('--')) || process.env.U1_MIRROR;

if (!mirror) {
  console.error('No mirror path given.');
  console.error('  node sync_mirror.mjs <path-to-mirror> [--write]');
  console.error('  or set U1_MIRROR');
  process.exit(2);
}
if (!existsSync(mirror) || !statSync(mirror).isDirectory()) {
  console.error('Not a directory: ' + mirror);
  process.exit(2);
}

// What the mirror is supposed to carry. Files that exist only over there are
// left alone: some are E5 siblings and older baselines this repo has no claim on.
const files = [
  'u1_calendar_interactive.html',
  'u1_gate.js', 'u1_scope.js', 'u1_review_ui.js', 'u1_review_panel.js', 'u1_baseline.js',
  'firestore.rules',
  ...readdirSync(here).filter((f) => f.endsWith('_test.mjs')).sort()
].filter((f) => existsSync(join(here, f)));

// Line endings are normalised for the comparison. Git rewrites them on checkout
// and a CRLF difference is not drift worth anyone's attention.
const norm = (s) => s.replace(/\r\n/g, '\n');
const out = [];

for (const f of files) {
  const a = norm(readFileSync(join(here, f), 'utf8'));
  const dst = join(mirror, f);
  if (!existsSync(dst)) { out.push(['MISSING', f]); continue; }
  if (norm(readFileSync(dst, 'utf8')) !== a) out.push(['DRIFTED', f]);
}

if (!out.length) {
  console.log('In step. ' + files.length + ' file(s) checked against ' + mirror);
  process.exit(0);
}
out.forEach(([why, f]) => console.log(why + '  ' + f));

if (!write) {
  console.log('\n' + out.length + ' of ' + files.length + ' out of step. Run with --write to fix.');
  process.exit(1);
}
out.forEach(([, f]) => writeFileSync(join(mirror, f), readFileSync(join(here, f))));
console.log('\nCopied ' + out.length + ' file(s) from the repo to the mirror.');
process.exit(0);
