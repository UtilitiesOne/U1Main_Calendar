// The duplicate message, the discard notice, and the stale-unit fix.
//
// All three come from one afternoon in production, 2026-09-02. An editor's post
// was discarded by the owner. Her tab kept the draft, because a discard deletes
// the server copy and deliberately leaves the local one, and nothing told her.
// She then tried to rebuild the post on a division lane and was refused with
// "This body already runs on the U1 Main lane (2026-09-02)".
//
// The refusal was correct. The message was not usable: the blocker was a
// triggered EVENT she had made herself and still had in her own draft, and she
// was sent looking at a date on U1 Main. findLaneDuplicate had flattened a
// scheduled post, an event and a lane post into one shape.
//
// Run: node dup_message_test.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'u1_calendar_interactive.html'), 'utf8');

function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  let depth = 0, j = i;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return src.slice(i, j);
}

let pass = 0, fail = 0;
const t = (n, c) => { c ? (pass++, console.log('PASS  ' + n)) : (fail++, console.log('FAIL  ' + n)); };

const LANES = [{ id: 'datacenters', name: 'Data Centers' }, { id: 'wireless', name: 'Wireless' }];
function build(state, live) {
  const ex = {};
  new Function('state', 'window', 'DIVISION_LANES', 'laneById', 'exports',
    grab('normBody') + '\n' + grab('findLaneDuplicate') + '\n' + grab('laneDuplicateMessage')
    + '\nexports.findLaneDuplicate = findLaneDuplicate;'
    + '\nexports.laneDuplicateMessage = laneDuplicateMessage;')
    (state,
     { __liveState: live },
     LANES,
     (id) => id === 'parent' ? { id: 'parent', name: 'U1 Main' } : LANES.find((l) => l.id === id),
     ex);
  return ex;
}

// Her body, near enough: long, datacenter-themed, over the 40-character floor.
const BODY = 'Data centers are designed to keep operating even when a critical component fails, '
  + 'which is why redundancy is planned in from the start rather than added later.';
const EMPTY = { slotOverrides: {}, triggeredEvents: [], lanes: {} };

// --- her exact situation: an event she made, still sitting in her own draft --
const herDraft = {
  slotOverrides: {},
  triggeredEvents: [{ id: 'e-1788366718043-h2e2n', date: '2026-09-02', note: BODY }],
  lanes: { datacenters: { posts: [] } }
};
const A = build(herDraft, EMPTY);
const dupEvent = A.findLaneDuplicate('datacenters', 'new-post', BODY);

t('the collision is still found, because the rule itself was right', !!dupEvent);
t('it is identified as an event, not flattened into "U1 Main lane"', dupEvent.kind === 'event');
t('it carries the event id, so the message can tell published from draft',
  dupEvent.id === 'e-1788366718043-h2e2n');

const msgEvent = A.laneDuplicateMessage(dupEvent);
t('the message says it is an event', /an event in your draft/.test(msgEvent));
t('it names the date', /2026-09-02/.test(msgEvent));
t('it says the event is only in her draft, the fact she was missing',
  /only in your draft/.test(msgEvent));
t('it tells her she can delete it and then save', /delete it and then save/.test(msgEvent));
t('it says nothing was saved, so she is not left guessing', /Nothing was saved just now/.test(msgEvent));
t('it no longer claims the body runs on the U1 Main lane', !/runs on the U1 Main lane/.test(msgEvent));

// --- the same event, published: a different action is needed ----------------
const B = build(herDraft, {
  slotOverrides: {},
  triggeredEvents: [{ id: 'e-1788366718043-h2e2n', date: '2026-09-02', note: BODY }],
  lanes: {}
});
const msgPub = B.laneDuplicateMessage(B.findLaneDuplicate('datacenters', 'new-post', BODY));
t('a published collision says so', /already published/.test(msgPub));
t('and does not tell her to delete what she cannot delete', !/delete it and then save/.test(msgPub));

// --- a scheduled U1 Main post ------------------------------------------------
const schedDraft = { slotOverrides: { '2026-09-02': { note: BODY } }, triggeredEvents: [], lanes: {} };
const C = build(schedDraft, schedDraft);
const dupSched = C.findLaneDuplicate('datacenters', 'x', BODY);
t('a scheduled post is identified as scheduled', dupSched.kind === 'sched');
t('and described as the U1 Main post on its date',
  /the U1 Main post on 2026-09-02/.test(C.laneDuplicateMessage(dupSched)));

// --- another division lane ---------------------------------------------------
const laneDraft = {
  slotOverrides: {}, triggeredEvents: [],
  lanes: { wireless: { posts: [{ id: 'p1', date: '2026-09-03', note: BODY }] }, datacenters: { posts: [] } }
};
const D = build(laneDraft, laneDraft);
t('another lane is named by lane, not by date alone',
  /on the Wireless lane \(2026-09-03\)/.test(D.laneDuplicateMessage(D.findLaneDuplicate('datacenters', 'x', BODY))));

// --- what must NOT be blocked ------------------------------------------------
t('a different body is not a collision',
  D.findLaneDuplicate('datacenters', 'x',
    'Something else entirely, comfortably past the forty character floor this rule uses.') === null);
t('editing a post in its own lane is not a collision with itself',
  D.findLaneDuplicate('wireless', 'p1', BODY) === null);
t('a short body is left alone, as before', D.findLaneDuplicate('datacenters', 'x', 'too short') === null);

// --- the discard now tells the editor ---------------------------------------
t('discarding writes a notification to the editor',
  /toUid: doc\.id,[\s\S]{0,240}?discarded your draft/.test(src));
t('the notice explains the stale tab, which is what actually confused her',
  /may still show it until you reload/.test(src));
t('the confirm warns the owner about the stale tab too',
  /their open tab will still show it until they reload/.test(src));
t('a failed discard reports itself rather than looking like success',
  /discard or its notice failed/.test(src));

// --- stale units --------------------------------------------------------------
t('the first unit write of a session reconciles against the server',
  /col\.get\(\)\.then\(function \(snap\)/.test(src));
t('and deletes units that no longer apply', /if \(!live\[k\]\) batch\.delete\(doc\.ref\);/.test(src));
t('later writes use the cheap in-memory path', /if \(fb\.unitKeysKnown\) \{/.test(src));
t('a failed reconcile still commits the writes it was guarding',
  /unit reconcile skipped[\s\S]{0,240}?batch\.commit\(\)/.test(src));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
