// Did the change reach the page people actually open?
//
// A green CI run and a live page are not the same moment. GitHub Pages took
// about three minutes and seven polls on 2026-09-01, and twice that day work was
// reported as shipped while the served file did not contain it. Once it was
// worse than a delay: three JS files had been edited without bumping their ?v=
// cache-busting strings, so the fix was on origin, on Pages, and on nobody's
// screen. Pushing is not shipping.
//
// This fetches the deployed files and checks the bytes actually served. It reads
// the script tags out of the served HTML rather than a hardcoded list, so a file
// added to the page is covered without anyone remembering to add it here.
//
//   node verify_deployed.mjs                      every local file is live
//   node verify_deployed.mjs mayEverEdit U1Notice  and these strings are present
//
// Cache-busted with a query string on every request, because the point is what
// the origin holds, not what this machine cached a minute ago.
const BASE = process.env.U1_DEPLOY_BASE
  || 'https://utilitiesone.github.io/U1Main_Calendar';
const PAGE = 'u1_calendar_interactive.html';
const wanted = process.argv.slice(2);

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const here = dirname(fileURLToPath(import.meta.url));

const norm = (s) => s.replace(/\r\n/g, '\n');
const bust = (u) => u + (u.includes('?') ? '&' : '?') + 'cb=' + Date.now() + Math.random();

async function get(path) {
  const res = await fetch(bust(BASE + '/' + path), { cache: 'no-store' });
  if (!res.ok) throw new Error(path + ': HTTP ' + res.status);
  return await res.text();
}

let pass = 0, fail = 0;
const t = (n, c) => { c ? (pass++, console.log('ok    ' + n)) : (fail++, console.log('STALE ' + n)); };

const servedPage = await get(PAGE);
t(PAGE + ' matches the local copy', norm(servedPage) === norm(readFileSync(join(here, PAGE), 'utf8')));

// Every local script the page loads, checked as served. The version string is
// part of the URL the browser requests, so it is fetched exactly as the page
// asks for it: a stale ?v= that returns old bytes shows up here.
const tags = [...servedPage.matchAll(/<script src="(u1_[a-z_]+\.js)(\?v=[0-9.]+)?"/g)];
t('the served page still loads its local scripts', tags.length > 0);

for (const [, file, v] of tags) {
  const local = join(here, file);
  if (!existsSync(local)) { t(file + ' exists locally', false); continue; }
  const served = await get(file + (v || ''));
  t(file + (v || '') + ' matches the local copy', norm(served) === norm(readFileSync(local, 'utf8')));
}

// Optional: strings the caller expects to be live. This is the check that
// catches a fix sitting on Pages behind a cache-busting string nobody bumped.
const all = servedPage + '\n' + (await Promise.all(tags.map(([, f, v]) => get(f + (v || ''))))).join('\n');
for (const s of wanted) t('"' + s + '" is present in what is served', all.includes(s));

console.log('\n' + pass + ' live, ' + fail + ' stale');
if (fail) console.log('Pages can lag a few minutes after a push. Re-run before concluding it failed.');
process.exit(fail ? 1 : 0);
