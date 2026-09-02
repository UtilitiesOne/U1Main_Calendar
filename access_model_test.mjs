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
//
// Pruned 2026-08-31 alongside the real document. Seeding had included everyone
// who had ever proposed or published, so nobody active was cut off while the
// allowlist went in; two accounts dormant since June came off once it was safe.
function token() {
  try {
    const p = join(homedir(), '.config', 'configstore', 'firebase-tools.json');
    return JSON.parse(readFileSync(p, 'utf8'))?.tokens?.access_token || null;
  } catch { return null; }
}

const TOKEN = token();

// Placeholders, deliberately. This repository is public, and until 2026-09-02 it
// carried five colleagues' personal email addresses in this file for no benefit:
// with a login the block below reads the real allowlist from config/roles, and
// without one the behavioural tier exits before these are ever used. They bought
// nothing and published people's addresses.
//
// The owner's address stays, in this file and in firestore.rules, because the
// rule hardcodes it and a test that mocks it would be testing a different rule.
//
// Anyone reading this: the live list is in Firestore at config/roles, not here.
const EDITORS = [
  'editor.one@example.com',
  'editor.two@example.com'
];

// The mock above is a written-down guess at what production holds, and a guess
// drifts. It did within a day: an editor added in the console on 2026-09-02 left
// the suite testing a list that no longer existed, so the last two cases were
// quietly asserting something about the wrong set of people.
//
// When this tier runs it already has a login, so it can just read the real
// document. The list above stays as the fallback and as documentation of who is
// expected, and any difference is printed rather than silently accepted.
let REAL_EDITORS = EDITORS;
if (TOKEN) {
  try {
    const r = await fetch('https://firestore.googleapis.com/v1/projects/' + PROJECT +
      '/databases/(default)/documents/config/roles', { headers: { Authorization: 'Bearer ' + TOKEN } });
    const j = await r.json();
    const live = (j?.fields?.editors?.arrayValue?.values || []).map((v) => v.stringValue);
    if (live.length) {
      // The written list is placeholders now, so a difference is expected and is
      // not worth a warning. What IS worth printing is how many real editors the
      // cases below are actually running against, since that number changing is
      // the only visible sign that somebody was added or removed.
      console.log('Using the live allowlist from config/roles: ' + live.length + ' editor(s).');
      console.log('');
      REAL_EDITORS = live;
    }
  } catch (e) {
    console.log('NOTE  could not read config/roles (' + (e && e.message) + '), using the written list.');
  }
}


// Two tiers, because CI has no Firebase credentials and an access test that
// simply refuses to run in CI protects nothing.
//
// The structural tier reads firestore.rules as text and needs no auth, so it
// runs everywhere including CI. It cannot prove the rules BEHAVE correctly, only
// that the guards are still written down: enough to catch someone deleting the
// allowlist check, which is the regression that actually worries me.
//
// The behavioural tier asks Google to evaluate the rules against simulated
// identities. It needs a login and is skipped, loudly, when there is none.
const RULES_SRC = readFileSync(RULES, 'utf8');
let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); }
}

t('structural: an approved-editor helper exists at all',
  /function isApprovedEditor\(\)/.test(RULES_SRC));
t('structural: the owner is hardcoded, so a broken list cannot lock him out',
  /function isOwnerEmail\(\)[\s\S]{0,200}wakroz@gmail\.com/.test(RULES_SRC));
t('structural: proposals still gate create on the allowlist',
  /allow create:[\s\S]{0,400}?isApprovedEditor\(\)/.test(RULES_SRC));
t('structural: the roles document is not world-writable',
  /match \/config\/roles[\s\S]{0,300}?allow write: if isOwnerEmail\(\)/.test(RULES_SRC));
// Asserted as a decision, not an oversight: leadership opens this board without
// signing in and a login wall was rejected as friction. If someone closes this,
// it should be because they meant to, and this line should fail loudly first.
t('structural: reading the calendar is still open, which is the decision',
  /match \/calendar\/live[\s\S]{0,200}?allow read: if true/.test(RULES_SRC));

const mocks = [
  { function: 'get', args: [{ exactValue: ROLES }], result: { value: { data: { editors: REAL_EDITORS } } } },
  { function: 'exists', args: [{ exactValue: ROLES }], result: { value: true } }
];

const who = (email, uid) => ({
  uid,
  token: { email, email_verified: true, sub: uid, aud: PROJECT, firebase: { sign_in_provider: 'google.com' } }
});
const OWNER = who(OWNER_EMAIL, 'owner1');
const EDITOR = who(REAL_EDITORS[0], 'cris1');
const STRANGER = who('someone.random@gmail.com', 'strange1');
// Guaranteed not on the live list, which is the property under test. Using a
// real ex-editor's address here only published it.
const REMOVED = who('removed.editor@example.com', 'gone1');
// Whoever sits last on the live list, so this follows production rather than a name.
const NEWEST = who(REAL_EDITORS[REAL_EDITORS.length - 1], 'new1');
const DRAFT = { submitted: false, state: {}, baseVersion: 65 };
const UNIT_CRIS    = DB + '/proposals/cris1/units/sched|2026-09-10';
const UNIT_STRANGE = DB + '/proposals/strange1/units/sched|2026-09-10';
const UNIT_GONE    = DB + '/proposals/gone1/units/sched|2026-09-10';
const UNITDOC = { key: 'sched|2026-09-10', kind: 'sched', action: 'upsert', obj: { note: 'x' } };

const cases = [
  ['a stranger who found the URL cannot create a proposal', 'DENY', STRANGER, DB + '/proposals/strange1', 'create', DRAFT],
  ['an approved editor still can', 'ALLOW', EDITOR, DB + '/proposals/cris1', 'create', DRAFT],
  ['the owner still can', 'ALLOW', OWNER, DB + '/proposals/owner1', 'create', DRAFT],
  ["a stranger cannot write into an editor's proposal", 'DENY', STRANGER, DB + '/proposals/cris1', 'update', DRAFT],
  ['a stranger cannot publish over live', 'DENY', STRANGER, DB + '/calendar/live', 'update', { v: 66 }],
  ['a stranger cannot add themselves to the editor list', 'DENY', STRANGER, ROLES, 'update', { editors: ['someone.random@gmail.com'] }],
  ['an editor cannot add themselves either', 'DENY', EDITOR, ROLES, 'update', { editors: REAL_EDITORS }],
  ['only the owner changes who may edit', 'ALLOW', OWNER, ROLES, 'update', { editors: REAL_EDITORS }],
  ['a signed-in viewer can read the calendar', 'ALLOW', STRANGER, DB + '/calendar/live', 'get', null],
  // Pruning is only real if a removed address actually loses write access.
  ['someone pruned off the list can no longer propose', 'DENY', REMOVED, DB + '/proposals/gone1', 'create', DRAFT],
  ['but can still read, like anyone else', 'ALLOW', REMOVED, DB + '/calendar/live', 'get', null],
  // --- per-post units, step 1 of the migration ------------------------------
  // The subcollection ships before any client writes it, so the shape is legal
  // first and rolls back by simply not writing. Access must be exactly the
  // parent's: an editor taken off the allowlist has to lose these writes at the
  // same moment they lose the parent document, or the allowlist has a back door.
  ['an approved editor writes their own units', 'ALLOW', EDITOR, UNIT_CRIS, 'create', UNITDOC],
  ['the owner writes any unit, which publishing will need', 'ALLOW', OWNER, UNIT_CRIS, 'create', UNITDOC],
  ['the owner reads them', 'ALLOW', OWNER, UNIT_CRIS, 'get', null],
  ['a stranger cannot write into an editor unit', 'DENY', STRANGER, UNIT_CRIS, 'create', UNITDOC],
  ['a stranger cannot read an editor unit', 'DENY', STRANGER, UNIT_CRIS, 'get', null],
  ['a stranger cannot write units under their own uid either, being off the list',
   'DENY', STRANGER, UNIT_STRANGE, 'create', UNITDOC],
  ['someone pruned off the list loses unit writes with the parent',
   'DENY', REMOVED, UNIT_GONE, 'create', UNITDOC],
  ['an editor cannot delete another editor unit', 'DENY', EDITOR, UNIT_GONE, 'delete', null],
  // The newest editor. A name on the list means nothing until a write is allowed.
  ['the most recently added editor can actually propose', 'ALLOW', NEWEST, DB + '/proposals/new1', 'create', DRAFT],
  ['and write their own units', 'ALLOW', NEWEST, DB + '/proposals/new1/units/sched|2026-09-10', 'create', UNITDOC]
];

const testCases = cases.map(([, expectation, auth, path, method, data]) => ({
  expectation,
  request: { auth, path, method, ...(data ? { resource: { data } } : {}) },
  functionMocks: mocks
}));

if (!TOKEN) {
  console.log('');
  console.log('SKIP  behavioural tier: no Firebase login on this machine.');
  console.log('      The structural checks above ran; run `firebase login` for the full set.');
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed, behavioural tier skipped');
  process.exit(fail ? 1 : 0);
}

const res = await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`, {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    source: { files: [{ name: 'firestore.rules', content: readFileSync(RULES, 'utf8') }] },
    testSuite: { testCases }
  })
});
const out = await res.json();
if (out.error) {
  // An expired login is the same situation as no login: this machine cannot ask
  // Google to evaluate the rules. Failing red for that reads like a rules problem
  // and sends you looking in the wrong place. A real API fault still fails.
  if (/authentication|credential|UNAUTHENTICATED|invalid_grant/i.test(out.error.message || '')) {
    console.log('');
    console.log('SKIP  behavioural tier: the Firebase login has expired. Run `firebase login` to include it.');
    console.log('');
    console.log(pass + ' passed, ' + fail + ' failed, behavioural tier skipped');
    process.exit(fail ? 1 : 0);
  }
  console.error('API error:', out.error.message);
  process.exit(1);
}
(out.issues || []).forEach((i) => console.log('RULES ISSUE  ' + i.description));

(out.testResults || []).forEach((r, i) => {
  const ok = r.state === 'SUCCESS';
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + cases[i][0]);
});
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
