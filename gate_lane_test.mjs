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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
