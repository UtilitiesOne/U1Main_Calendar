// Regression for the 2026-08-28 incident.
//
// A stale draft held two blank slots. Against live those blanks were real
// changes, so the publish path judged them, and each one reported three true
// but useless findings: signature missing, no hashtags, visual missing. The
// owner opened the date, saw the PUBLISHED post sitting there with its
// signature, and reasonably concluded the gate was broken. Separately the
// publish path stamped l1:'blocked' on the editor's proposal and wrote no
// review, so the editor's panel still showed the previous day's warnings about
// different posts entirely.
//
// Two guarantees are locked in here:
//   1. An empty post reports ONE finding that says it is empty, and stops.
//   2. Nothing about that check leaks into posts that do have a body.
//
// The second fix (writeHeldReview addressing the proposer) lives in
// u1_review_ui.js inside a closure with a live Firebase dependency, so it is
// covered by the shape assertions at the bottom rather than by execution.
//
// Run: node empty_post_test.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const load = (f) => { const w = {}; new Function('window', readFileSync(join(here, f), 'utf8'))(w); return w; };
const Gate = load('u1_gate.js').U1Gate;
const uiSrc = readFileSync(join(here, 'u1_review_ui.js'), 'utf8');

let pass = 0, fail = 0;
function t(name, cond) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); } }

const SIG = "We don't overpromise. We overdeliver.";
const IMG = 'https://firebasestorage.googleapis.com/v0/b/u1-calendar.firebasestorage.app/o/post-images%2Ft%2Fa.png?alt=media';
const META = { w: 1200, h: 800 };

const base = { date: '2026-08-31', themeId: 't5', themeName: 'From Financed Paper to Delivered Field',
               tagline: 'From paper to field.', bodyActivationRequired: false, trustLine: '', image: '', imageMeta: null };

// --- 1. the exact shape that caused the incident -----------------------------
const empty = Gate.checkPost({ ...base, text: '' });
t('empty note yields exactly one finding', empty.length === 1);
t('that finding names emptiness, not the signature', empty[0].rule === 'Post is empty');
t('it is a BLOCK', empty[0].level === 'BLOCK');
t('it warns that publishing would replace a live post', /replace it with a blank one/.test(empty[0].why));
t('no signature finding on an empty post', !empty.some(i => /signature/i.test(i.rule)));
t('no hashtag finding on an empty post', !empty.some(i => /hashtag/i.test(i.rule)));
t('no visual finding on an empty post', !empty.some(i => /[Vv]isual/.test(i.rule)));

// --- 2. neighbouring blank shapes --------------------------------------------
t('whitespace-only note is empty', Gate.checkPost({ ...base, text: '   \n\n\t  ' }).length === 1);
t('hashtags with no prose is empty', Gate.checkPost({ ...base, text: '#UtilitiesOne #Fulfillment #FromPaperToField' })[0].rule === 'Post is empty');
t('a missing text field is empty, not a crash', Gate.checkPost({ ...base, text: undefined })[0].rule === 'Post is empty');

// --- 3. the check must not leak into real posts ------------------------------
const good = Gate.checkPost({ ...base, text: 'A real body that says something. ' + SIG + ' #UtilitiesOne #Fulfillment #FromPaperToField',
                              trustLine: 'Responsibility. Someone signs for it.', image: IMG, imageMeta: META });
t('a complete post is clean', good.length === 0);

const noSig = Gate.checkPost({ ...base, text: 'A real body with no close line. #UtilitiesOne #Fulfillment #FromPaperToField',
                               trustLine: 'Safety.', image: IMG, imageMeta: META });
t('a bodied post missing its signature still says so', noSig.some(i => /signature/i.test(i.rule)));
t('and is NOT reported as empty', !noSig.some(i => i.rule === 'Post is empty'));

// --- 4. division lanes take the same path ------------------------------------
const lane = Gate.checkPost({ ...base, text: '', laneId: 'water', laneName: 'Water', laneTag: '#Water' });
t('an empty lane post reports emptiness once', lane.length === 1 && lane[0].rule === 'Post is empty');

// --- 5. the verdict wrapper still behaves ------------------------------------
const v = Gate.verdict(empty);
t('an empty post cannot submit', v.canSubmit === false && v.blocks === 1);

// --- 6. the review-write fix is wired ----------------------------------------
t('writeReviewFor exists (review can be addressed to another user)', /function writeReviewFor\(uid, email, res\)/.test(uiSrc));
t('writeReviewFor writes to the passed uid, not fb.user', /doc\('auto_' \+ uid\)/.test(uiSrc));
t('writeHeldReview exists', /function writeHeldReview\(uid, email, held\)/.test(uiSrc));
// Ordering assertion, deliberately not distance-based: the block between these
// two lines grew when the draft-rebase fix landed, and a character budget would
// keep breaking for reasons that have nothing to do with the property. What
// matters is only that the reasons are written BEFORE the block is stamped, so
// the panel is never newer than the status it explains.
t('publishPerPost writes the review before stamping the block',
  uiSrc.indexOf('writeHeldReview(proposalId, proposerEmail, held)') > -1 &&
  uiSrc.indexOf("l1: 'blocked'") > uiSrc.indexOf('writeHeldReview(proposalId, proposerEmail, held)'));
t('labelForChange names lane, event and scheduled units', /function labelForChange/.test(uiSrc) && /' lane'/.test(uiSrc) && /'Scheduled post'/.test(uiSrc));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
