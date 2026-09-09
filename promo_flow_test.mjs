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
// Pinned to the invariant, not to the literal rule text. The rule's shape has changed
// twice; what must never change is that an editor cannot reach a state past Alex.
const EDITOR_BRANCH = (SRC.match(/isApprovedEditor\(\)[\s\S]*?\n {23}\);/) || [''])[0];
t('structural: an editor can never reach a state past Alex',
  EDITOR_BRANCH.length > 0
  && !/'with_denis'/.test(EDITOR_BRANCH.split('posted_claimed')[0])
  && !/'approved'[\s,]*\]/.test(EDITOR_BRANCH)
  && !/'declined'/.test(EDITOR_BRANCH));
t('structural: an editor may work while drafting or after Denis sent it back',
  /promoEditableStates\(\)[\s\S]{0,400}?return \['drafting', 'needs_edits'\]/.test(SRC));

const PAGE = readFileSync(join(here, 'u1_promotion_programme.html'), 'utf8');
t('the page turns Remove off once a post leaves drafting',
  /function syncImageControls[\s\S]{0,600}?cur !== 'drafting'[\s\S]{0,200}?rm\.disabled = frozen/.test(PAGE));
t('it is wired into the one place that knows the current state',
  /syncImageControls\(id, sel\.value\)/.test(PAGE));

// The two pages have to point at each other, and the public path has to use the
// query the rules permit. A plain .get() on promo_posts is refused for a signed-out
// reader, because a collection read that COULD return a denied document is refused
// outright. Get that wrong and the page looks broken instead of empty.
const CAL = readFileSync(join(here, 'u1_calendar_interactive.html'), 'utf8');
t('the calendar links to the programme',
  /href="u1_promotion_programme\.html"/.test(CAL));
t('the programme links back to the calendar',
  /href="u1_calendar_interactive\.html"/.test(PAGE));
t('the public path queries only what the rules allow',
  /where\('status', 'in', PUBLIC_STATES\)/.test(PAGE) && /PUBLIC_STATES = \['approved', 'posted_claimed', 'posted'\]/.test(PAGE));
t('a signed-out visitor gets the public view rather than a dead page',
  /loadPublic\(\)/.test(PAGE) && /Signed out\.'\); loadPublic/.test(PAGE));
t('a signed-in non-editor gets it too',
  /if \(isEditor\) loadPosts\(\); else loadPublic/.test(PAGE));
t('the public panel says why a draft is not shown',
  /he has not seen them/.test(PAGE));

// The About is a different artifact from a post, written once rather than weekly, and it
// lives in the same document so it travels the same approval path. If it ever moves out of
// the page, the approval trail splits in two and the trail is what proves a man said yes.
t('the page has an About field per person',
  /id="about-\$\{p\.id\}"/.test(PAGE));
// An About is written once, not weekly. The first version stored it on the week's post
// document, and loadPosts fills each card from that person's LATEST weekOf, so the About
// would have vanished from the card the moment a second week existed. It has its own
// document now, keyed by person alone, with its own approval state.
t('the About has its own document, keyed by person and not by week',
  /doc\(id \+ '_about'\)/.test(PAGE));
t('it is marked so it can never be read as a week',
  /kind: 'about'/.test(PAGE));
t('and savePost does NOT write it, so a week can never carry it',
  !/about/.test((PAGE.match(/function savePost[\s\S]*?\n}/) || [''])[0]));
t('loadPosts separates the two kinds',
  /x\.kind === 'about'/.test(PAGE));
t('and fills the About from its own record, not from the latest post',
  /a\.value = \(ab && ab\.about\)/.test(PAGE));
t('the About carries its own approval state',
  /function fillAboutStates/.test(PAGE) && /aboutstate-/.test(PAGE));

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
  // The About goes in the same document, so promoEditableStates already covers it.
  // Proven rather than assumed: an untested field is a field nobody knows is covered.
  ['an editor can write his About while drafting', 'ALLOW', EDITOR, 'update', post('drafting', { about: 'two lines in his register' }), post('drafting')],
  ['an editor cannot change his About once Alex has it', 'DENY', EDITOR, 'update', post('with_alex', { about: 'rewritten after approval' }), post('with_alex')],
  ['an editor cannot change his About once Denis has it', 'DENY', EDITOR, 'update', post('with_denis', { about: 'rewritten under him' }), post('with_denis')],
  ['an editor cannot pull it back from Denis', 'DENY', EDITOR, 'update', post('drafting'), post('with_denis')],
  ['an editor cannot record a verdict', 'DENY', EDITOR, 'update', post('declined'), post('with_denis')],
  ['nobody creates a post that is already approved', 'DENY', EDITOR, 'create', post('with_denis'), null],
  ['nobody creates one already posted', 'DENY', EDITOR, 'create', post('posted'), null],

  // The split read, decided 2026-09-09. 'posted' is the only state that opens, because
  // those words are already on the man's public profile. Everything else stays shut,
  // including with_denis, where the drafts are in flight and nobody has answered yet.
  // The needs_edits loop, added 2026-09-09. Denis asks for changes, it goes back to
  // the editor who submitted it, they fix it and it runs the same road again.
  ['an editor may work on one Denis sent back', 'ALLOW', EDITOR, 'update', post('needs_edits', { body: 'fixed' }), post('needs_edits')],
  ['and hand it up again', 'ALLOW', EDITOR, 'update', post('with_alex'), post('needs_edits')],
  ['what Denis sent back is not public, it is back in the loop', 'DENY', null, 'get', null, post('needs_edits')],

  // Reporting it live. Only from approved, and the words cannot move with it.
  ['an editor may report an approved post as live', 'ALLOW', EDITOR, 'update', post('posted_claimed'), post('approved')],
  ['but not change the words while doing it', 'DENY', EDITOR, 'update', post('posted_claimed', { body: 'switched' }), post('approved')],
  ['and cannot jump a draft straight to live, which would publish it', 'DENY', EDITOR, 'update', post('posted_claimed'), post('drafting')],
  ['nor one Denis has not seen', 'DENY', EDITOR, 'update', post('posted_claimed'), post('with_denis')],
  ['an editor cannot confirm it themselves', 'DENY', EDITOR, 'update', post('posted'), post('posted_claimed')],
  ['Alex confirms it', 'ALLOW', ALEX, 'update', post('posted'), post('posted_claimed')],
  ['a claimed-live post is public, since it is on his page', 'ALLOW', null, 'get', null, post('posted_claimed')],

  // Collection reads, which Firestore judges differently from a single-document get.
  // The public view depends on this and nothing covered it until 2026-09-09.
  ['a signed-out visitor cannot list the collection', 'DENY', null, 'list', null, null],
  ['an editor can', 'ALLOW', EDITOR, 'list', null, null],

  ['anyone may read a post the man has approved', 'ALLOW', null, 'get', null, post('approved')],
  ['anyone may read a post that is already live on his profile', 'ALLOW', null, 'get', null, post('posted')],
  ['a draft stays shut to the public', 'DENY', null, 'get', null, post('drafting')],
  ['one Alex has approved stays shut, he has not sent it yet', 'DENY', null, 'get', null, post('with_alex')],
  ['one in flight to the men stays shut, nobody has answered', 'DENY', null, 'get', null, post('with_denis')],
  ['a declined one stays shut, his no is his own business', 'DENY', null, 'get', null, post('declined')],
  ['an editor still reads every state', 'ALLOW', EDITOR, 'get', null, post('drafting')],

  // Outsiders.
  ['a stranger cannot create one', 'DENY', STRANGER, 'create', post('drafting'), null],
  ['a stranger cannot read a draft', 'DENY', STRANGER, 'get', null, post('drafting')],
  ['a stranger cannot move one along', 'DENY', STRANGER, 'update', post('posted'), post('with_denis')],

  // Alex keeps full control, including correcting a mistake.
  ['Alex can send it back to drafting', 'ALLOW', ALEX, 'update', post('drafting'), post('with_alex')],
  ['Alex can edit a post at any stage', 'ALLOW', ALEX, 'update', post('with_denis', { body: 'fixed a typo' }), post('with_denis')]
];

const testCases = cases.map(([, expectation, auth, method, data, existing]) => ({
  expectation,
  request: {
    // auth null means signed out, which is the case the split read exists for.
    ...(auth ? { auth } : {}),
    path: P, method,
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

// The refusal message has to name the cause. Blaming the freeze every time sent
// people hunting for an approval that had never happened.
// The post id comes from the file being deleted, never from the week field on
// screen. An editor who rolls the week forward after attaching an image would
// otherwise have a different document read back, and be told to press Save when
// saving would not help.
// savePost legitimately builds the id from the fields on screen; that is where the
// post is being created. Only the diagnostic must read it from the file instead.
const CLEAR = (PAGE.match(/function clearImage[\s\S]*?\n}/) || [''])[0];
t('the diagnostic identifies the post from the file, not from the week field',
  /function postIdFromUrl/.test(PAGE)
  && /doc\(postId\)/.test(CLEAR)
  && !/week/.test(CLEAR));

// storage.rules freezes DELETION past drafting. It puts no status condition on
// write, and firestore.rules gives the owner an unconditional update, so a visual
// CAN still be replaced after approval. The tooltip must not promise otherwise.
t('the frozen tooltip does not claim an approval covers the image forever',
  !/approval always covers the image/.test(PAGE));

t('a refusal distinguishes an unsaved post from a frozen one',
  /has not been saved yet/.test(PAGE) && /has left drafting and its visual is frozen/.test(PAGE));
t('and says plainly when a drafting post was refused, which means a broken config',
  /configuration problem rather than anything you did/.test(PAGE));


/* Review links. Denis has no account, so the unguessable document id is the
   credential. These cases are the security of that arrangement, so they are the ones
   to read hardest. Run against the real rules API, not a mock. */
const RL = DB + '/review_links/tok_abcdef123456';
const link = (extra = {}) => ({ postId: 'stoica_2026-09-14', personId: 'stoica',
  personName: 'Stefan Stoica', body: 'his post', weekOf: '2026-09-14', ...extra });

const linkCases = [
  ['anyone holding the link may read it', 'ALLOW', null, 'get', null, link()],
  ['only Alex mints one', 'DENY', EDITOR, 'create', link(), null],
  ['Alex mints one', 'ALLOW', ALEX, 'create', link(), null],
  ['only Alex revokes one', 'DENY', EDITOR, 'delete', null, link()],

  // Denis answering, with no account at all.
  ['Denis approves from the link', 'ALLOW', null, 'update',
   link({ response: 'approved', comment: '', respondedAt: 'x' }), link()],
  ['Denis asks for edits from the link', 'ALLOW', null, 'update',
   link({ response: 'edits', comment: 'change the second line', respondedAt: 'x' }), link()],

  // The cases that must fail. Each is a way the link could be turned into more
  // than one man answering one question.
  ['he cannot answer twice', 'DENY', null, 'update',
   link({ response: 'approved', respondedAt: 'y' }), link({ response: 'edits' })],
  ['he cannot rewrite the post he was shown', 'DENY', null, 'update',
   link({ body: 'different words', response: 'approved', respondedAt: 'x' }), link()],
  ['he cannot repoint the link at another post', 'DENY', null, 'update',
   link({ postId: 'denis_2026-09-14', response: 'approved', respondedAt: 'x' }), link()],
  ['he cannot invent a verdict we do not recognise', 'DENY', null, 'update',
   link({ response: 'posted', respondedAt: 'x' }), link()],
  ['he cannot delete the record of what he was asked', 'DENY', null, 'delete', null, link()],
];

const linkTests = linkCases.map(([, expectation, auth, method, data, existing]) => ({
  expectation,
  request: { ...(auth ? { auth } : {}), path: RL, method,
    ...(data ? { resource: { data } } : {}) },
  ...(existing ? { resource: { data: existing } } : {}),
  functionMocks: mocks
}));

const rl = await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`, {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content: SRC }] },
    testSuite: { testCases: linkTests } })
});
const rlOut = await rl.json();
if (rlOut.error) { console.error('review-link API error: ' + rlOut.error.message); process.exit(1); }
(rlOut.testResults || []).forEach((r, i) => t(linkCases[i][0], r.state === 'SUCCESS'));


// The review page and the wiring around it. Structural, so CI runs them without a login.
const REVIEW = readFileSync(join(here, 'u1_promo_review.html'), 'utf8');
t('the review page exists and is never indexed',
  /name="robots"/.test(REVIEW));
t('it authenticates nobody, the link is the credential',
  !/firebase-auth-compat/.test(REVIEW) && /URLSearchParams/.test(REVIEW));
t('it reads only the link document, never promo_posts',
  /collection\('review_links'\)/.test(REVIEW) && !/collection\('promo_posts'\)/.test(REVIEW));
t('it writes only a verdict, a comment and a time',
  /response: verdict/.test(REVIEW) && /comment: comment/.test(REVIEW)
  && /respondedAt:/.test(REVIEW));
t('an answered link cannot be answered again',
  /if \(d\.response\) { alreadyAnswered/.test(REVIEW));
t('sending back needs a reason, approving does not',
  /verdict === 'edits' && !comment/.test(REVIEW));

// Minting the link and setting with_denis are one action, so the state cannot claim
// it is with Denis when no link exists.
t('minting the link sets with_denis in the same action',
  /function sendToDenis/.test(PAGE)
  && /status: 'with_denis', reviewToken: token/.test(PAGE));
t('the link carries a snapshot, not a pointer into the closed record',
  /body: el\('text-' \+ id\)\.value,/.test(PAGE.split('function sendToDenis')[1] || ''));
t('only the owner is offered the send button, and only from with_alex',
  /isOwner && cur === 'with_alex'/.test(PAGE));

// The other half of 'records it': his answer has to reach Alex or it sits unseen.
t("Denis's answers are surfaced for the owner",
  /function watchVerdicts/.test(PAGE) && /if \(!db || !isOwner\) return;/.test(PAGE));
t('accepting an answer is what moves the post, and the owner does it',
  /function acceptVerdict/.test(PAGE)
  && /response === 'approved' \? 'approved' : 'needs_edits'/.test(PAGE));
t('the link is deleted once its answer has been recorded',
  /\.delete\(\)\)/.test(PAGE.split('function acceptVerdict')[1] || ''));


// Three findings from the second read of 2026-09-09.
t('the page no longer claims promo-images is editors-only, which it is not',
  !/only signed-in editors can read/.test(PAGE)
  && /signed-in Google account to read/.test(PAGE));
t('the state control says which states are world-readable',
  /readable by anyone with the link/.test(PAGE));

console.log('\n' + pass + ' passed, ' + fail + ' failed');

process.exit(fail ? 1 : 0);
