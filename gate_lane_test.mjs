// Gate engine regression: recalibration (2026-08-10) + division lane rules.
// Pure node, no Firebase. Run: node gate_lane_test.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const g = {};
new Function('window', readFileSync(join(here, 'u1_gate.js'), 'utf8'))(g);
const Gate = g.U1Gate;

const SIG = "We don't overpromise. We overdeliver.";
// Every post ships with its visual (locked 2026-08-11), so a "clean" fixture carries one.
const IMG = 'https://firebasestorage.googleapis.com/v0/b/u1-calendar.firebasestorage.app/o/post-images%2Ft%2Fa.png?alt=media';
let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name); }
}
function run(post) { return Gate.checkPost(post); }
function levels(items, rule) { return items.filter(i => i.rule === rule).map(i => i.level); }
function has(items, rule, level) { return items.some(i => i.rule === rule && (!level || i.level === level)); }

// Parent: bad post still blocks (signature missing, banned tag).
let r = run({ text: 'We built a thing. #UtilitiesOne #Construction #Water', trustLine: 'x', tagline: '', bodyActivationRequired: false });
t('parent: missing signature blocks', has(r, 'Locked signature missing', 'BLOCK'));
t('parent: banned tag blocks', has(r, 'Banned tag', 'BLOCK'));

// Recalibration: declared line #1, activation present, tag echo missing -> WARN only, no activation block.
r = run({ text: 'A route proves its utility on day one. ' + SIG + ' #UtilitiesOne #Water #GridHardening', trustLine: 'Safety', tagline: 'One Company. Every Utility.', bodyActivationRequired: true, image: IMG });
t('recal: activation present, no activation block', !has(r, 'Body-activation missing'));
t('recal: tag echo missing is WARN not BLOCK', levels(r, 'Brand-line tag echo missing').join() === 'WARN');
t('recal: nothing blocks this post', r.every(i => i.level !== 'BLOCK'));

// Recalibration: declared line #1, no activation -> still BLOCK.
r = run({ text: 'We finished the job well. ' + SIG + ' #UtilitiesOne #Water #GridHardening #OneCompanyEveryUtility', trustLine: 'Safety', tagline: 'One Company. Every Utility.', bodyActivationRequired: true });
t('recal: missing activation still blocks', has(r, 'Body-activation missing', 'BLOCK'));

// Division lane: good post is clean.
const laneMeta = { laneId: 'water', laneName: 'Water', laneTag: '#Water' };
r = run({ ...laneMeta, text: 'Our crews replaced 400 feet of main for the city. ' + SIG + ' #UtilitiesOne #Water #WaterInfrastructure', trustLine: 'Responsibility', tagline: '', image: IMG });
t('lane: clean division post has no blocks', r.every(i => i.level !== 'BLOCK'));

// Division lane: parent brand line on the visual blocks.
r = run({ ...laneMeta, text: 'Good work by the team. ' + SIG + ' #UtilitiesOne #Water', trustLine: 'x', tagline: 'One Company. Every Utility.' });
t('lane: parent line on division visual blocks', has(r, 'Parent brand line on a division visual', 'BLOCK'));

// Division lane: missing signature blocks; missing division tag blocks.
r = run({ ...laneMeta, text: 'Good work by the team. #UtilitiesOne #Water', trustLine: 'x', tagline: '' });
t('lane: missing signature blocks', has(r, 'Locked signature missing', 'BLOCK'));
r = run({ ...laneMeta, text: 'Good work by the team. ' + SIG + ' #UtilitiesOne #WaterInfrastructure', trustLine: 'x', tagline: '' });
t('lane: missing division tag blocks', has(r, 'Division tag missing', 'BLOCK'));

// Division lane: #UtilitiesOneWater satisfies the division tag; brand-line tag warns.
r = run({ ...laneMeta, text: 'Our crews finished the survey. ' + SIG + ' #UtilitiesOne #UtilitiesOneWater #BuiltToHold', trustLine: 'x', tagline: '' });
t('lane: parent-plus-division tag accepted', !has(r, 'Division tag missing'));
t('lane: brand-line tag on division post warns', levels(r, 'Parent line tag on a division post').join() === 'WARN');

// Shared checks run on both surfaces: long dash blocks in a lane post too.
r = run({ ...laneMeta, text: 'The crew did well — again. ' + SIG + ' #UtilitiesOne #Water', trustLine: 'x', tagline: '' });
t('lane: long dash still blocks', has(r, 'Long-dash AI-tell', 'BLOCK'));

// Parent path unaffected by lane code: theme check still fires.
r = run({ themeId: 't6', text: 'Welcome to the team, our new director joins us. ' + SIG + ' #UtilitiesOne #Water #GridHardening', trustLine: 'x', tagline: '', bodyActivationRequired: false });
t('parent: new-hire wrong theme still blocks', has(r, 'Wrong theme for a new-hire post', 'BLOCK'));

// Visual checks (2026-08-11, Alex: image is a BLOCK).
const OWN = 'https://firebasestorage.googleapis.com/v0/b/u1-calendar.firebasestorage.app/o/post-images%2Fx%2F1.png?alt=media';
const goodBody = 'A route proves its utility on day one. ' + SIG + ' #UtilitiesOne #Water #WaterInfrastructure';
r = run({ text: goodBody, trustLine: 'Safety', tagline: '', image: OWN, imageMeta: { w: 1200, h: 1200, bytes: 200000 } });
t('visual: own-bucket image passes clean', r.every(i => i.level !== 'BLOCK'));

r = run({ text: goodBody, trustLine: 'Safety', tagline: '' });
t('visual: missing image blocks', has(r, 'Visual missing', 'BLOCK'));

r = run({ text: goodBody, trustLine: 'Safety', tagline: '', image: 'https://images.example.com/pasted.jpg' });
t('visual: outside image blocks', has(r, 'Visual is not in our library', 'BLOCK'));

r = run({ text: goodBody, trustLine: 'Safety', tagline: '', image: OWN, imageMeta: { w: 600, h: 600, bytes: 90000 } });
t('visual: small image warns, never blocks', levels(r, 'Visual is small for the feed').join() === 'WARN');

r = run({ text: goodBody, trustLine: 'Safety', tagline: '', image: OWN, imageMeta: { w: 3000, h: 500, bytes: 90000 } });
t('visual: extreme ratio warns', levels(r, 'Unusual aspect ratio').join() === 'WARN');

r = run({ ...laneMeta, text: 'Our crews replaced the main. ' + SIG + ' #UtilitiesOne #Water', trustLine: 'x', tagline: '' });
t('visual: lane post also requires an image', has(r, 'Visual missing', 'BLOCK'));

/* Video visuals (2026-10-07). A video rides the same field as an image, so the
   presence and our-library rules must not care which kind it is, and the shape
   rules must stop applying the stills thresholds to a clip. The 16:9 case is the
   one that matters most: 1920x1080 is ratio 1.78, which the image rule passes and
   would have gone on passing, but a 2.2 ratio clip is fine for video and would
   have warned under the old 2.0 ceiling. */
const VID = 'https://firebasestorage.googleapis.com/v0/b/u1-calendar.firebasestorage.app/o/post-images%2Fx%2Fclip.mp4?alt=media';
const vidBody = { text: goodBody, trustLine: 'Safety', tagline: '' };

r = run({ ...vidBody, image: VID, imageMeta: { kind: 'video', w: 1920, h: 1080, seconds: 45, bytes: 9000000 } });
t('video: a clean 16:9 clip raises nothing on the visual', !has(r, 'Visual missing') && !has(r, 'Video is small for the feed') && !has(r, 'Unusual aspect ratio') && !has(r, 'Video is longer than we allow'));

r = run({ ...vidBody, image: VID, imageMeta: { kind: 'video', w: 640, h: 360, seconds: 20, bytes: 2000000 } });
t('video: small clip warns, never blocks', levels(r, 'Video is small for the feed').join() === 'WARN');

r = run({ ...vidBody, image: VID, imageMeta: { kind: 'video', w: 200, h: 120, seconds: 20, bytes: 500000 } });
t('video: under the published floor on both sides is a BLOCK', has(r, 'Video is below the feed minimum', 'BLOCK'));

r = run({ ...vidBody, image: VID, imageMeta: { kind: 'video', w: 200, h: 120, seconds: 20, bytes: 500000 } });
t('video: a blocked-size clip does not also warn about being small', !has(r, 'Video is small for the feed'));

/* The floor is 256 wide by 144 high, not 144 square. A 200x150 clip clears a
   144-on-both-sides test and is still under the published width floor, which is
   exactly what the first version of this check let through. */
r = run({ ...vidBody, image: VID, imageMeta: { kind: 'video', w: 200, h: 150, seconds: 20, bytes: 500000 } });
t('video: 200x150 is under the width floor and blocks', has(r, 'Video is below the feed minimum', 'BLOCK'));

r = run({ ...vidBody, image: VID, imageMeta: { kind: 'video', w: 300, h: 160, seconds: 20, bytes: 500000 } });
t('video: 300x160 clears the floor and only warns on size', !has(r, 'Video is below the feed minimum') && levels(r, 'Video is small for the feed').join() === 'WARN');

r = run({ ...vidBody, image: VID, imageMeta: { kind: 'video', w: 1080, h: 1080, seconds: 240, bytes: 50000000 } });
t('video: over three minutes is a BLOCK', has(r, 'Video is longer than we allow', 'BLOCK'));

/* PDF carousels (2026-10-25). On LinkedIn a carousel is a document post, so the
   visual is one PDF. It rides the same field as an image or a video, presence and
   our-library still apply, and only LinkedIn's two document limits can block it.
   A PDF has no width or height, so none of the image or video shape rules may
   fire on it. */
const DOC = 'https://firebasestorage.googleapis.com/v0/b/u1-calendar.firebasestorage.app/o/post-images%2Fx%2Fcarousel.pdf?alt=media';

r = run({ ...vidBody, image: DOC, imageMeta: { kind: 'document', bytes: 4000000, pages: 8 } });
t('carousel: a clean PDF counts as the visual', !has(r, 'Visual missing') && !has(r, 'Visual is not in our library'));
t('carousel: no image or video shape rule fires on a PDF', !has(r, 'Visual is small for the feed') && !has(r, 'Unusual aspect ratio') && !has(r, 'Video is small for the feed'));
t('carousel: a clean PDF raises no carousel finding', !has(r, 'Carousel is larger than LinkedIn accepts') && !has(r, 'Carousel has more pages than LinkedIn accepts'));

r = run({ ...vidBody, image: DOC, imageMeta: { kind: 'document', bytes: 4000000, pages: null } });
t('carousel: an unknown page count is not a finding', !has(r, 'Carousel has more pages than LinkedIn accepts') && !has(r, 'Visual missing'));

r = run({ ...vidBody, image: DOC, imageMeta: { kind: 'document', bytes: 120 * 1024 * 1024, pages: 10 } });
t('carousel: over 100MB is a BLOCK', has(r, 'Carousel is larger than LinkedIn accepts', 'BLOCK'));

r = run({ ...vidBody, image: DOC, imageMeta: { kind: 'document', bytes: 4000000, pages: 301 } });
t('carousel: over 300 pages is a BLOCK', has(r, 'Carousel has more pages than LinkedIn accepts', 'BLOCK'));

r = run({ ...vidBody, image: DOC, imageMeta: { kind: 'document', bytes: 4000000, pages: 300 } });
t('carousel: exactly 300 pages is fine', !has(r, 'Carousel has more pages than LinkedIn accepts'));

r = run({ ...vidBody, image: 'https://example.com/deck.pdf', imageMeta: { kind: 'document', bytes: 4000000, pages: 8 } });
t('carousel: a PDF outside our library still blocks like any visual', has(r, 'Visual is not in our library', 'BLOCK'));

r = run({ ...vidBody, image: '', imageMeta: null });
t('carousel: a carousel post with no file attached is still Visual missing', has(r, 'Visual missing', 'BLOCK'));

r = run({ ...vidBody, image: VID, imageMeta: { kind: 'video', w: 2200, h: 1000, seconds: 30, bytes: 9000000 } });
t('video: 2.2 ratio passes where the stills rule would have warned', !has(r, 'Unusual aspect ratio'));

r = run({ ...vidBody, image: VID, imageMeta: { kind: 'video', w: 3000, h: 500, seconds: 30, bytes: 9000000 } });
t('video: past 2.4:1 still warns', levels(r, 'Unusual aspect ratio').join() === 'WARN');

r = run({ ...vidBody, image: '', imageMeta: { kind: 'video', w: 1920, h: 1080, seconds: 30, bytes: 9000000 } });
t('video: metadata without a file is still Visual missing', has(r, 'Visual missing', 'BLOCK'));

r = run({ ...vidBody, image: 'https://cdn.example.com/clip.mp4', imageMeta: { kind: 'video', w: 1920, h: 1080, seconds: 30, bytes: 9000000 } });
t('video: an outside-host clip is not in our library', has(r, 'Visual is not in our library', 'BLOCK'));

r = run({ ...vidBody, image: OWN, imageMeta: { w: 600, h: 600, bytes: 90000 } });
t('video change did not alter the image path', levels(r, 'Visual is small for the feed').join() === 'WARN');

// Career promotion line (added 2026-08-13): recognized on the parent, echo advisory, blocked on lanes.
const RISE = 'Talent is the entry. Hard work is the rise.';
r = run({ text: 'Promoted to foreman after four years on the crew. ' + SIG + ' #UtilitiesOne #Wireline #HardWorkIsTheRise', trustLine: 'Training', tagline: RISE, image: IMG });
t('rise line: clean promotion post has no blocks', r.every(i => i.level !== 'BLOCK'));
t('rise line: echo tag accepted in taxonomy', !r.some(i => i.rule === 'Off-taxonomy tag'));
r = run({ text: 'Promoted to foreman after four years on the crew. ' + SIG + ' #UtilitiesOne #Wireline', trustLine: 'Training', tagline: RISE, image: IMG });
t('rise line: missing echo is WARN not BLOCK', levels(r, 'Brand-line tag echo missing').join() === 'WARN');
r = run({ ...laneMeta, text: 'Good work by the team. ' + SIG + ' #UtilitiesOne #Water', trustLine: 'x', tagline: RISE });
t('rise line: on a division visual still blocks', has(r, 'Parent brand line on a division visual', 'BLOCK'));

// General-tag policy on people and event posts (Alex 2026-08-18): Career Arc
// (t2) and U1 Culture (t7) allow general and event-name tags; the work-type
// taxonomy stays enforced everywhere else.
r = run({ themeId: 't2', text: 'Welcome to the team, our new Director. #UtilitiesOne #WelcomeToTheTeam #Hiring', trustLine: 'x', tagline: '', bodyActivationRequired: false, image: IMG });
t('t2 welcome: general tags pass (no off-taxonomy block)', !has(r, 'Tag outside the taxonomy'));
t('t2 welcome: no banned-tag block either', !has(r, 'Banned tag'));
r = run({ themeId: 't7', text: 'Our team at the expo this week. #UtilitiesOne #MountainConnect #Networking', trustLine: 'x', tagline: '', bodyActivationRequired: false, image: IMG });
t('t7 event: event-name tags pass', !has(r, 'Tag outside the taxonomy'));
r = run({ themeId: 't5', text: 'Capability post. ' + SIG + ' #UtilitiesOne #WelcomeToTheTeam #Hiring', trustLine: 'x', tagline: '', bodyActivationRequired: false, image: IMG });
t('t5 capability: same general tags still blocked', has(r, 'Tag outside the taxonomy', 'BLOCK'));
r = run({ themeId: 't2', text: 'Welcome aboard! #WelcomeToTheTeam #Hiring #NewChapter', trustLine: 'x', tagline: '', bodyActivationRequired: false, image: IMG });
t('t2 welcome: parent tag still required', has(r, 'Parent tag missing', 'BLOCK'));
r = run({ themeId: 't7', text: 'Expo recap. #UtilitiesOne #A #B #C #D #E #F', trustLine: 'x', tagline: '', bodyActivationRequired: false, image: IMG });
t('t7 event: 3-to-5 count still enforced', has(r, 'Tag count out of range', 'BLOCK'));

// Curly-apostrophe signature (2026-08-24, caught live): a pasted body carrying
// the signature with U+2019 must pass, not read as "signature missing".
const CURLY_SIG = 'We don’t overpromise. We overdeliver.';
r = run({ text: 'A route proves its utility on day one. ' + CURLY_SIG + ' #UtilitiesOne #Water #WaterInfrastructure', trustLine: 'Safety', tagline: '', bodyActivationRequired: false, image: IMG });
t('curly-apostrophe signature passes as verbatim', !has(r, 'Locked signature missing') && !has(r, 'Locked signature not verbatim'));
r = run({ text: 'A curly-quoted “claim” with the line. ' + CURLY_SIG + ' #UtilitiesOne #Water #WaterInfrastructure', trustLine: 'Safety', tagline: '', image: IMG });
t('curly double quotes never block', r.every(i => i.level !== 'BLOCK'));

// Scope engine: a skipped slot is removed in app terms; its leftover text is
// never evaluated (caught 2026-08-18 on the skipped Aug 17 Consulting slot).
const gs = {};
new Function('window', readFileSync(join(here, 'u1_scope.js'), 'utf8'))(gs);
const Scope = gs.U1Scope;
let sp = Scope.postsFrom({ slotOverrides: { '2026-08-17': { note: 'leftover text', skipped: true, themeId: 't6' } }, triggeredEvents: [] });
t('scope: skipped slot with leftover text is not a post', sp.length === 0);
sp = Scope.postsFrom({ slotOverrides: { '2026-08-17': { note: 'leftover text', themeId: 't6' } }, triggeredEvents: [] });
t('scope: same slot unskipped is a post again', sp.length === 1);

// Empty placeholder events are not posts yet (Paul's welcome, 2026-08-18).
sp = Scope.postsFrom({ slotOverrides: {}, triggeredEvents: [{ id: 'ph1', date: '2026-08-25', note: '', trustLine: '' }] });
t('scope: empty placeholder event is not a post', sp.length === 0);
sp = Scope.postsFrom({ slotOverrides: {}, triggeredEvents: [{ id: 'ph1', date: '2026-08-25', note: 'Welcome Paul.', trustLine: '' }] });
t('scope: placeholder with content written is a post', sp.length === 1);

// Lane posts join the baseline: untouched lane content is grandfathered.
const laneState = { slotOverrides: {}, triggeredEvents: [],
  lanes: { water: { posts: [{ id: 'w1', date: '2026-08-17', note: 'Water lane body', trustLine: 'T' }] } } };
const lb = Scope.buildBaseline(laneState, 'lane-test');
t('scope: baseline carries the lane post', lb.keys[Scope.laneKey('water', 'w1')] !== undefined);
t('scope: lane fingerprint stable for unchanged post',
  lb.keys[Scope.laneKey('water', 'w1')] === Scope.laneFingerprint(laneState.lanes.water.posts[0]));
t('scope: lane fingerprint moves when the body changes',
  lb.keys[Scope.laneKey('water', 'w1')] !== Scope.laneFingerprint({ note: 'Edited body', trustLine: 'T' }));


/* People and moments (2026-10-16). The rebalance-surface rules stopped being
   applied to the Career Arc and U1 Culture themes after a holiday post was
   blocked for carrying two tags and told to add a brand line. Fixture is the
   real post: Indigenous Peoples' Day, 2026-10-12, two tags, no signature,
   no TRUST line. */
const HOLIDAY = 'Today, we recognize Indigenous Peoples\u2019 Day by honoring the rich histories, '
  + 'cultures, and contributions of Indigenous peoples across the United States. '
  + '#IndigenousPeoplesDay #UtilitiesOne';
r = run({ themeId: 't7', themeName: 'U1 Culture', text: HOLIDAY, trustLine: '', tagline: '', image: IMG });
t('culture: the real holiday post does not block', r.every(i => i.level !== 'BLOCK'));
t('culture: two tags is not a count failure', !has(r, 'Tag count out of range'));
t('culture: no TRUST line is not flagged', !has(r, 'TRUST line not authored'));
t('culture: no brand line is ever asked for', !r.some(i => /brand line/i.test(String(i.change))));

// The ceiling holds, and even then the fix never names the brand line.
r = run({ themeId: 't7', themeName: 'U1 Culture', image: IMG, trustLine: '', tagline: '',
  text: 'Our teams marked the day on site. #UtilitiesOne #IndigenousPeoplesDay #Culture #Team #Field #Proud' });
t('culture: more than five tags still blocks', has(r, 'Tag count out of range', 'BLOCK'));
t('culture: the over-count fix names no brand line',
  !r.filter(i => i.rule === 'Tag count out of range').some(i => /brand line/i.test(String(i.change))));

// The parent tag is not optional on any surface, whatever the count does.
r = run({ themeId: 't7', themeName: 'U1 Culture', text: 'A day to remember. #IndigenousPeoplesDay',
  trustLine: '', tagline: '', image: IMG });
t('culture: parent tag still required', has(r, 'Parent tag missing', 'BLOCK'));

// The words the buyer-not-consumer rule catches are the subject of a
// remembrance post (the 11 September 2026 post was flagged for "families").
const REMEMBRANCE = 'Today, we remember the people who lost their lives and the families, '
  + 'first responders, and communities affected. #UtilitiesOne #Remembrance';
r = run({ themeId: 't7', themeName: 'U1 Culture', text: REMEMBRANCE, trustLine: '', tagline: '', image: IMG });
t('culture: consumer register is not flagged on a remembrance post', !has(r, 'Consumer register'));
t('culture: remembrance post does not block', r.every(i => i.level !== 'BLOCK'));

// A caption pasted into the TRUST field is still a mistake on this class.
r = run({ themeId: 't7', themeName: 'U1 Culture', text: HOLIDAY, tagline: '', image: IMG,
  trustLine: 'x'.repeat(401) });
t('culture: caption in the TRUST field still blocks', has(r, 'Wrong field used', 'BLOCK'));

/* The rebalance surface is untouched by all of the above. */
r = run({ themeId: 't6', themeName: 'One Company, Every Utility', image: IMG, trustLine: '', tagline: '',
  text: 'A route proves its utility on day one, for the families we serve. ' + SIG + ' #UtilitiesOne #Water' });
t('parent: two tags still blocks', has(r, 'Tag count out of range', 'BLOCK'));
t('parent: the count fix still names the missing layer',
  r.some(i => i.rule === 'Tag count out of range' && /brand line/i.test(String(i.change))));
t('parent: TRUST line still flagged', has(r, 'TRUST line not authored', 'WARN'));
t('parent: consumer register still flagged', has(r, 'Consumer register', 'WARN'));

// A division lane post is not a people-and-moments post: it has no theme.
r = run({ ...laneMeta, text: 'Good work by the team. ' + SIG + ' #UtilitiesOne #Water', trustLine: '', tagline: '', image: IMG });
t('lane: TRUST line still flagged on a lane post', has(r, 'TRUST line not authored', 'WARN'));

// A brand line does not belong on a holiday visual. The editor no longer offers
// one on this class, so this catches stored data and any other write path.
r = run({ themeId: 't7', themeName: 'U1 Culture', text: HOLIDAY, trustLine: '', image: IMG,
  tagline: 'One Company. Every Utility.', bodyActivationRequired: true });
// The gate raises nothing at all about a visual tagline on a culture post, not
// even as a note (Alex 2026-10-16).
t('culture: a declared brand line is not flagged', !has(r, 'Brand line on a culture visual'));
t('culture: no brand-line tag echo note', !has(r, 'Brand-line tag echo missing'));
t('culture: no tagline punctuation note', !has(r, 'Tagline punctuation'));
// The 2026-06-08 activation rule is locked and still reaches this class. It is
// dormant on every live culture post, and it is Alex's call to narrow.
t('culture: the locked activation rule still applies where the line is declared',
  has(r, 'Body-activation missing', 'BLOCK'));

// The Career Arc keeps its own line, so it draws no culture warning.
r = run({ themeId: 't2', themeName: 'The U1 Career Arc', image: IMG, trustLine: '',
  tagline: 'One Way. Talent finds its lane.',
  text: 'Welcome to the team, and good luck on the first drop. #UtilitiesOne #WelcomeToTheTeam' });
t('career arc: its own tagline is not flagged', !has(r, 'Brand line on a culture visual'));
t('career arc: nothing blocks this post', r.every(i => i.level !== 'BLOCK'));

// The rebalance surface still has to earn the line it declares.
r = run({ themeId: 't6', themeName: 'One Company, Every Utility', image: IMG, trustLine: 'Safety',
  tagline: 'One Company. Every Utility.', bodyActivationRequired: true,
  text: 'We finished the job well. ' + SIG + ' #UtilitiesOne #Water #GridHardening #OneCompanyEveryUtility' });
t('parent: activation still blocks where the line is declared', has(r, 'Body-activation missing', 'BLOCK'));
t('parent: no culture warning on the rebalance surface', !has(r, 'Brand line on a culture visual'));

t('rulebook version moved with the rules', Gate.RULES_VERSION === '2026-10-25');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
