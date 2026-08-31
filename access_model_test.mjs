// Who may do what, tested against the real firestore.rules file.
//
// Named for what it asserts rather than for the file it reads, because a
// rules_test.mjs already exists in output/2026-08-07_u1_brand_gate and is a
// different thing entirely: it drives the local emulator through
// @firebase/rules-unit-testing. This one asks the deployed rules directly and
// needs no emulator. Two files with one name in two places that are meant to
// stay byte-identical is how the wrong one gets copied over the right one.
//
// This is the only automated check on the access model, and it exists because
// that model was wrong for months without anyone noticing: isEditor was
// literally "is signed in", so any Google account that found the URL could
// create a proposal in U1's calendar. Nothing failed, nothing warned, and the
// code carried a comment saying "No editor allowlist" the whole time. A silent
// hole stays open until something asserts it is shut.
//
// Reading is deliberately open. Leadership opens this board without signing in
// and a login wall was rejected as friction, so "a signed-in viewer can read"
// and the anonymous read in the deployed app are the intended behaviour, not
// gaps this suite forgot to cover.
//
// The rules call get() on config/roles, which the test API does not resolve
// against real data, so that document is mocked with what production holds.
// Keep the mock in step with the real list or the last two cases go soft.
//
// Run: node access_model_test.mjs      (needs `firebase login` first)
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Resolve next to this file, not to the working directory: this suite is run
// both from the calendar repo and from its mirror in output/, and a bare
// relative path silently picks up whichever rules file the shell happened to
// be standing in.
const RULES = join(dirname(fileURLToPath(import.meta.url)), 'firestore.rules');

const PROJECT = 'u1-calendar';
const DB = '/databases/(default)/documents';
const ROLES = DB + '/config/roles';
const OWNER_EMAIL = 'wakroz@gmail.com';

// Mirrors config/roles in production. The owner is deliberately absent: he is
// hardcoded in the rules so a broken or missing list can never lock him out.
const EDITORS = [
  'cristina.costin@moldcablecom.onmicrosoft.com',
  'andrewscodreanu@gmail.com',
  'catamatei7@gmail.com',
  'catamatthew7@gmail.com',
  'vlaicumatarin@gmail.com'
];

function token() {
  const p = join(homedir(), '.config', 'configstore', 'firebase-tools.json');
  const t = JSON.parse(readFileSync(p, 'utf8'))?.tokens?.access_token;
  if (!t) throw new Error('no firebase credentials found; run `firebase login`');
  return t;
}

const mocks = [
  { function: 'get', args: [{ exactValue: ROLES }], result: { value: { data: { editors: EDITORS } } } },
  { function: 'exists', args: [{ exactValue: ROLES }], result: { value: true } }
];

const who = (email, uid) => ({
  uid,
  token: { email, email_verified: true, sub: uid, aud: PROJECT, firebase: { sign_in_provider: 'google.com' } }
});
const OWNER = who(OWNER_EMAIL, 'owner1');
const EDITOR = who(EDITORS[0], 'cris1');
const STRANGER = who('someone.random@gmail.com', 'strange1');
const DRAFT = { submitted: false, state: {}, baseVersion: 65 };

const cases = [
  ['a stranger who found the URL cannot create a proposal', 'DENY', STRANGER, DB + '/proposals/strange1', 'create', DRAFT],
  ['an approved editor still can', 'ALLOW', EDITOR, DB + '/proposals/cris1', 'create', DRAFT],
  ['the owner still can', 'ALLOW', OWNER, DB + '/proposals/owner1', 'create', DRAFT],
  ["a stranger cannot write into an editor's proposal", 'DENY', STRANGER, DB + '/proposals/cris1', 'update', DRAFT],
  ['a stranger cannot publish over live', 'DENY', STRANGER, DB + '/calendar/live', 'update', { v: 66 }],
  ['a stranger cannot add themselves to the editor list', 'DENY', STRANGER, ROLES, 'update', { editors: ['someone.random@gmail.com'] }],
  ['an editor cannot add themselves either', 'DENY', EDITOR, ROLES, 'update', { editors: EDITORS }],
  ['only the owner changes who may edit', 'ALLOW', OWNER, ROLES, 'update', { editors: EDITORS }],
  ['a signed-in viewer can read the calendar', 'ALLOW', STRANGER, DB + '/calendar/live', 'get', null]
];

const testCases = cases.map(([, expectation, auth, path, method, data]) => ({
  expectation,
  request: { auth, path, method, ...(data ? { resource: { data } } : {}) },
  functionMocks: mocks
}));

const res = await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`, {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' },
  body: JSON.stringify({
    source: { files: [{ name: 'firestore.rules', content: readFileSync(RULES, 'utf8') }] },
    testSuite: { testCases }
  })
});
const out = await res.json();
if (out.error) { console.error('API error:', out.error.message); process.exit(1); }
(out.issues || []).forEach((i) => console.log('RULES ISSUE  ' + i.description));

let pass = 0, fail = 0;
(out.testResults || []).forEach((r, i) => {
  const ok = r.state === 'SUCCESS';
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + cases[i][0]);
});
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
