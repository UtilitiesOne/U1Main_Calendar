// The promotion programme's approval flow, tested against the rules file.
//
// The flow: the team drafts, Alex approves it for sending, it goes to Denis,
// Denis coordinates with his people and comes back with one verdict, then we
// post. Denis Mezheretskov is Senior Director of Construction Field Services
// (01_capture_log.md) and the roster reports through him, so his verdict covers
// them and the coordination behind it is his.
//
// Denis never touches this app. His answer reaches Alex by message and Alex
// enters it, so the record says Alex recorded Denis's verdict rather than
// implying Denis clicked something. That is why only the owner can move a post
// out of with_denis.
//
// Why this lives in the rules and not only in the page: the calendar learned in
// August that a client-side gate is decoration. An editor's own submission never
// met it, devtools walked around it, and the server rule is what held. The thing
// gated here publishes to a named person's personal profile, so it earns the
// same treatment.
//
// The cases that must FAIL are the point of this suite. An editor approving
// their own draft, an editor editing the body after Alex approved it, anyone
// jumping straight to posted. Those are the routes by which a post could reach a
// man's profile carrying an approval that does not belong to the words in it.
//
// Run: node promo_flow_test.mjs      (needs `firebase login` for the full set)
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const RULES = join(here, 'firestore.rules');
const PROJECT = 'u1-calendar';
const DB = '/databases/(default)/documents';
const ROLES = DB + '/config/roles';
const SRC = readFileSync(RULES, 'utf8');

function token() {
  try {
    const p = join(homedir(), '.config', 'configstore', 'firebase-tools.json');
    return JSON.parse(readFileSync(p, 'utf8'))?.tokens?.access_token || null;
  } catch { return null; }
}

let pass = 0, fail = 0;
const t = (n, c) => { c ? (pass++, console.log('PASS  ' + n)) : (fail++, console.log('FAIL  ' + n)); };

// Structural tier. Runs in CI with no credentials.
t('structural: the flow states are written down',
  /drafting[\s\S]{0,500}with_alex[\s\S]{0,500}with_denis/.test(SRC));
t('structural: a new post must start in drafting',
  /allow create:[\s\S]{0,220}?promoState\(request\.resource\.data\) == 'drafting'/.test(SRC));
t('structural: an editor can only ever hand it up, never further',
  /promoState\(request\.resource\.data\) in \['drafting', 'with_alex'\]/.test(SRC));
t('structural: an editor can only edit while it is still in drafting',
  /promoState\(resource\.data\) in promoEditableStates\(\)/.test(SRC));

const TOKEN = token();
if (!TOKEN) {
  console.log('');
  console.log('SKIP  behavioural tier: no Firebase login on this machine.');
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed, behavioural tier skipped');
  process.exit(fail ? 1 : 0);
}

const EDITORS = [
  'cristina.costin@moldcablecom.onmicrosoft.com',
  'andrewscodreanu@gmail.com',
  'catamatei7@gmail.com',
  'ianatoma35@gmail.com'
];
const mocks = [
  { function: 'get', args: [{ exactValue: ROLES }], result: { value: { data: { editors: EDITORS } } } },
  { function: 'exists', args: [{ exactValue: ROLES }], result: { value: true } }
];
const who = (email, uid) => ({
  uid,
  token: { email, email_verified: true, sub: uid, aud: PROJECT, firebase: { sign_in_provider: 'google.com' } }
});
const ALEX = who('wakroz@gmail.com', 'alex');
const EDITOR = who(EDITORS[0], 'ed1');
const STRANGER = who('nobody@gmail.com', 'x1');

const P = DB + '/promo_posts/stoica_2026-09-08';
const post = (status, extra = {}) => ({
  personId: 'stoica', weekOf: '2026-09-08', body: 'his words', status, ...extra
});

const cases = [
  // The happy path, one step at a time.
  ['an editor starts a draft', 'ALLOW', EDITOR, 'create', post('drafting'), null],
  ['an editor edits their draft', 'ALLOW', EDITOR, 'update', post('drafting', { body: 'better words' }), post('drafting')],
  ['an editor hands it up to Alex', 'ALLOW', EDITOR, 'update', post('with_alex'), post('drafting')],
  ['Alex sends it to Denis', 'ALLOW', ALEX, 'update', post('with_denis'), post('with_alex')],
  ['Alex records the yes Denis gave him, and posts it', 'ALLOW', ALEX, 'update', post('posted'), post('with_denis')],
  ['Alex records a no from Denis', 'ALLOW', ALEX, 'update', post('declined'), post('with_denis')],

  // The cases that must fail. Each is a route to a man's profile carrying an
  // approval that does not belong to the words in the post.
  ['an editor cannot approve their own draft', 'DENY', EDITOR, 'update', post('with_denis'), post('with_alex')],
  ['an editor cannot send it to Denis themselves', 'DENY', EDITOR, 'update', post('with_denis'), post('drafting')],
  ['an editor cannot mark it posted', 'DENY', EDITOR, 'update', post('posted'), post('drafting')],
  ['an editor cannot jump a draft straight to posted', 'DENY', EDITOR, 'update', post('posted'), post('with_alex')],
  ['an editor cannot edit the body once Alex has it', 'DENY', EDITOR, 'update', post('with_alex', { body: 'changed after approval' }), post('with_alex')],
  ['an editor cannot edit the body once Denis has it', 'DENY', EDITOR, 'update', post('with_denis', { body: 'changed under him' }), post('with_denis')],
  ['an editor cannot pull it back from Denis', 'DENY', EDITOR, 'update', post('drafting'), post('with_denis')],
  ['an editor cannot record a verdict', 'DENY', EDITOR, 'update', post('declined'), post('with_denis')],
  ['nobody creates a post that is already approved', 'DENY', EDITOR, 'create', post('with_denis'), null],
  ['nobody creates one already posted', 'DENY', EDITOR, 'create', post('posted'), null],

  // Outsiders.
  ['a stranger cannot create one', 'DENY', STRANGER, 'create', post('drafting'), null],
  ['a stranger cannot read one', 'DENY', STRANGER, 'get', null, post('drafting')],
  ['a stranger cannot move one along', 'DENY', STRANGER, 'update', post('posted'), post('with_denis')],

  // Alex keeps full control, including correcting a mistake.
  ['Alex can send it back to drafting', 'ALLOW', ALEX, 'update', post('drafting'), post('with_alex')],
  ['Alex can edit a post at any stage', 'ALLOW', ALEX, 'update', post('with_denis', { body: 'fixed a typo' }), post('with_denis')]
];

const testCases = cases.map(([, expectation, auth, method, data, existing]) => ({
  expectation,
  request: {
    auth, path: P, method,
    ...(data ? { resource: { data } } : {})
  },
  ...(existing ? { resource: { data: existing } } : {}),
  functionMocks: mocks
}));

const res = await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`, {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    source: { files: [{ name: 'firestore.rules', content: SRC }] },
    testSuite: { testCases }
  })
});
const out = await res.json();
if (out.error) {
  if (/authentication|credential|UNAUTHENTICATED/i.test(out.error.message || '')) {
    console.log('\nSKIP  behavioural tier: the Firebase login has expired. Run `firebase login`.');
    console.log('\n' + pass + ' passed, ' + fail + ' failed, behavioural tier skipped');
    process.exit(fail ? 1 : 0);
  }
  console.error('API error:', out.error.message);
  process.exit(1);
}
(out.issues || []).forEach((i) => console.log('RULES ISSUE  ' + i.description));
(out.testResults || []).forEach((r, i) => t(cases[i][0], r.state === 'SUCCESS'));


// The page must not offer a Remove button that the storage rule will refuse.
// storage.rules allows a delete only while a post is drafting and makes no owner
// exception, so once a post leaves drafting nobody can remove its visual. An
// enabled button that always fails is worse than no button.
//
// This is a MATCH, never the enforcement. The rule holds; this only keeps the UI
// honest about what the rule will do. The same suite above proves the server side.
const PAGE = readFileSync(join(here, 'u1_promotion_programme.html'), 'utf8');
t('the page turns Remove off once a post leaves drafting',
  /function syncImageControls[\s\S]{0,600}?cur !== 'drafting'[\s\S]{0,200}?rm\.disabled = frozen/.test(PAGE));
t('it is wired into the one place that knows the current state',
  /syncImageControls\(id, sel\.value\)/.test(PAGE));

// The refusal message has to name the cause. Blaming the freeze every time sent
// people hunting for an approval that had never happened.
t('a refusal distinguishes an unsaved post from a frozen one',
  /has not been saved yet/.test(PAGE) && /has left drafting and its visual is frozen/.test(PAGE));
t('and says plainly when a drafting post was refused, which means a broken config',
  /configuration problem rather than anything you did/.test(PAGE));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
