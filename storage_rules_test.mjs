// Who may read and write which files.
//
// These rules lived only in the Firebase console until 2026-09-07, so nothing
// reviewed them and nothing could test them. They are now in the repo and this
// suite runs against the file, the same way access_model_test.mjs runs against
// firestore.rules.
//
// The case that matters most is the regression one. The calendar depends on
// post-images for every post image it shows, and adding the promotion
// programme's path meant touching a file the calendar relies on. If a future
// edit weakens or drops that block, these cases fail before anyone notices in
// production.
//
// The two paths differ on READ, deliberately. post-images is world-readable
// because the calendar itself is open to read, so its images have to be.
// promo-images requires auth because it holds visuals prepared for a named
// person's personal post before he has seen it, matching the Firestore side
// where that draft copy is restricted to signed-in editors.
//
// Run: node storage_rules_test.mjs      (needs `firebase login` first)
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const RULES = join(here, 'storage.rules');
const PROJECT = 'u1-calendar';
const BUCKET = 'u1-calendar.firebasestorage.app';
const O = '/b/' + BUCKET + '/o';

function token() {
  try {
    const p = join(homedir(), '.config', 'configstore', 'firebase-tools.json');
    return JSON.parse(readFileSync(p, 'utf8'))?.tokens?.access_token || null;
  } catch { return null; }
}

const SRC = readFileSync(RULES, 'utf8');
let pass = 0, fail = 0;
const t = (n, c) => { c ? (pass++, console.log('PASS  ' + n)) : (fail++, console.log('FAIL  ' + n)); };

// Structural tier: runs anywhere, including CI, with no credentials.
t('structural: the calendar path still exists', /match \/post-images\/\{allPaths=\*\*\}/.test(SRC));
t('structural: the calendar path is still world-readable, which it must be',
  /match \/post-images[\s\S]{0,120}?allow read: if true/.test(SRC));
// The path carries the post id, personId_weekOf, because the delete rule has to
// find that exact post to read its status.
t('structural: the programme path exists and is keyed by post',
  /match \/promo-images\/\{postId\}\/\{file\}/.test(SRC));
t('structural: the programme path is NOT world-readable',
  !/match \/promo-images[\s\S]{0,140}?allow read:\s*if true/.test(SRC));
t('structural: both paths keep the 10MB ceiling',
  (SRC.match(/request\.resource\.size < 10 \* 1024 \* 1024/g) || []).length === 2);
t('structural: both paths keep the image-only content type',
  (SRC.match(/contentType\.matches\('image\/\.\*'\)/g) || []).length === 2);
t('structural: programme images are deletable while drafting',
  /allow delete:[\s\S]{0,320}?status == 'drafting'/.test(SRC));
t('structural: the delete rule requires the post to exist',
  /firestore\.exists\(\/databases\/\(default\)\/documents\/promo_posts/.test(SRC));
t('structural: the calendar path has no delete rule, so nothing there changed',
  !/match \/post-images[\s\S]{0,400}?allow delete/.test(SRC));

const TOKEN = token();
if (!TOKEN) {
  console.log('');
  console.log('SKIP  behavioural tier: no Firebase login on this machine.');
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed, behavioural tier skipped');
  process.exit(fail ? 1 : 0);
}

const auth = { uid: 'someone' };
const img = { size: 1024 * 500, contentType: 'image/png' };
const big = { size: 11 * 1024 * 1024, contentType: 'image/png' };
const pdf = { size: 1024, contentType: 'application/pdf' };

const cases = [
  // The regression guard: the calendar must keep working exactly as before.
  ['calendar images stay public to read', 'ALLOW', null, O + '/post-images/u1/x.png', 'get', null],
  ['a signed-in user can still upload a calendar image', 'ALLOW', auth, O + '/post-images/u1/x.png', 'create', img],
  ['a signed-out user still cannot upload one', 'DENY', null, O + '/post-images/u1/x.png', 'create', img],
  ['the 10MB ceiling still holds on the calendar path', 'DENY', auth, O + '/post-images/u1/x.png', 'create', big],
  ['non-images are still refused on the calendar path', 'DENY', auth, O + '/post-images/u1/x.pdf', 'create', pdf],

  // The new path, and its one real difference.
  ['a signed-in editor can upload a programme visual', 'ALLOW', auth, O + '/promo-images/u1/x.png', 'create', img],
  ['a draft programme visual is NOT readable signed out', 'DENY', null, O + '/promo-images/u1/x.png', 'get', null],
  ['it is readable once signed in', 'ALLOW', auth, O + '/promo-images/u1/x.png', 'get', null],
  ['the 10MB ceiling holds there too', 'DENY', auth, O + '/promo-images/u1/x.png', 'create', big],
  ['non-images are refused there too', 'DENY', auth, O + '/promo-images/u1/x.pdf', 'create', pdf],

  // Nothing else is writable, which is how it was before.
  ['an unlisted path is still closed', 'DENY', auth, O + '/anything-else/x.png', 'create', img],

  // The freeze. An image can be removed while the post is still being drafted,
  // and not once Alex has approved it for sending, so the visual cannot change
  // underneath an approval. Same moment the body freezes in firestore.rules.
  ['a visual is deletable while the post is drafting', 'ALLOW', auth,
   O + '/promo-images/stoica_2026-09-08/x.png', 'delete', null, 'drafting'],
  ['it is frozen once Alex has it', 'DENY', auth,
   O + '/promo-images/stoica_2026-09-08/x.png', 'delete', null, 'with_alex'],
  ['frozen while Denis has it', 'DENY', auth,
   O + '/promo-images/stoica_2026-09-08/x.png', 'delete', null, 'with_denis'],
  ['frozen once posted', 'DENY', auth,
   O + '/promo-images/stoica_2026-09-08/x.png', 'delete', null, 'posted'],
  ['frozen on a declined post too, so the record survives', 'DENY', auth,
   O + '/promo-images/stoica_2026-09-08/x.png', 'delete', null, 'declined'],
  ['a signed-out visitor cannot delete even a draft visual', 'DENY', null,
   O + '/promo-images/stoica_2026-09-08/x.png', 'delete', null, 'drafting'],
  ['an image whose post is missing is refused, leaving a visible orphan', 'DENY', auth,
   O + '/promo-images/stoica_2026-09-08/x.png', 'delete', null, null]
];

/* The delete rule reads promo_posts via firestore.get(), which the test API does
   not resolve against real data, so each case mocks the status it is testing. A
   status of null mocks the document as missing.

   READ THIS BEFORE TRUSTING A GREEN RUN. Mocking the Firestore read is exactly
   what this suite cannot check, and on 2026-09-07 every case below passed while
   the rule refused every single delete in production. Cross-service rules, which
   is what a Storage rule reading Firestore is, only run once the Firebase Storage
   service agent holds roles/firebaserules.firestoreServiceAgent. Firebase grants
   it when you are prompted on your first such deploy; ours went out through the
   CLI non-interactively, so nothing granted it, the read failed, and the whole
   condition evaluated false.

   So a green run here means the rule is WRITTEN correctly. It does not mean the
   rule RUNS. The only check for that is deleting a real file on the real bucket,
   which is how the fault was eventually found: upload to a throwaway path, then
   confirm REFUSED with no post document, ALLOWED with the post drafting, and
   REFUSED once it has left drafting. */
const POSTDOC = '/databases/(default)/documents/promo_posts/stoica_2026-09-08';
const testCases = cases.map(([, expectation, a, path, method, data, status]) => ({
  expectation,
  request: {
    ...(a ? { auth: a } : {}),
    path, method,
    ...(data ? { resource: data } : {})
  },
  ...(status !== undefined ? {
    functionMocks: [
      { function: 'firestore.exists', args: [{ exactValue: POSTDOC }],
        result: { value: status !== null } },
      { function: 'firestore.get', args: [{ exactValue: POSTDOC }],
        result: status === null ? { undefined: {} } : { value: { data: { status } } } }
    ]
  } : {})
}));

const res = await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`, {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    source: { files: [{ name: 'storage.rules', content: SRC }] },
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

console.log('\n' + pass + ' passed, ' + fail + ' failed');

/* Printed, not left as a comment at the top of the file. On 2026-09-07 this suite
   reported 27 of 27 while the rule refused every delete in production, and a note
   nobody sees is a note that does not work. */
if (!fail) {
  console.log('');
  console.log('CAVEAT  The delete cases above mock the Firestore read, so they prove the rule is');
  console.log('        WRITTEN correctly and say nothing about whether it RUNS. Cross-service rules');
  console.log('        need roles/firebaserules.firestoreServiceAgent on the storage service agent.');
  console.log('        Check production: upload to a throwaway path, then expect REFUSED with no');
  console.log('        post document, ALLOWED with it drafting, REFUSED once past drafting.');
}
process.exit(fail ? 1 : 0);
