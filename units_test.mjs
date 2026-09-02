// The dual write: one document per post, alongside the existing save.
//
// Step 2 of the per-post migration. NOTHING READS THESE YET. The whole-state
// save is still the source of truth, so every case here is about the units
// being correct and about the existing save being unharmed.
//
// Driven through a stubbed Firestore rather than asserted as source shape,
// because the interesting behaviour is what gets batched: which docs are set,
// which are deleted when an editor undoes a change, and what happens when the
// write fails. A regex over the source would prove none of that.
//
// Run: node units_test.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'u1_calendar_interactive.html'), 'utf8');

// Pull both functions out of the app so this tests what ships.
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

// --- a Firestore stub that records what it was asked to do -----------------
function makeEnv(commitFails, server = [], serverFails = false) {
  const log = { set: [], delete: [], committed: 0, warned: [] };
  const doc = (id) => ({ __id: id });
  const batch = {
    set: (d, data) => log.set.push([d.__id, data]),
    delete: (d) => log.delete.push(d.__id),
    commit: () => commitFails ? Promise.reject(new Error('permission denied')) : (log.committed++, Promise.resolve())
  };
  // The collection has to answer get(), because the first write of a session
  // reconciles against what is actually stored rather than trusting memory.
  // `server` stands for what Firestore already holds, which is how a unit
  // orphaned by an earlier session gets simulated.
  const col = {
    doc,
    get: () => serverFails
      ? Promise.reject(new Error('read denied'))
      : Promise.resolve({
          forEach: (f) => server.forEach((k) => f({ data: () => ({ key: k }), ref: doc(k), id: k }))
        })
  };
  const firebase = {
    firestore: Object.assign(() => ({
      batch: () => batch,
      collection: () => ({ doc: () => ({ collection: () => col }) })
    }), { FieldValue: { serverTimestamp: () => '__ts__' } })
  };
  const fb = { user: { uid: 'u1' } };
  const env = { FIREBASE_ON: true, firebase, fb, console: { warn: (...a) => log.warned.push(a.join(' ')) } };
  const fn = new Function('FIREBASE_ON', 'firebase', 'fb', 'console', 'exports',
    grab('encodeUnitKey') + '\n' + grab('writeUnits') + '\nexports.writeUnits = writeUnits;');
  const ex = {};
  fn(env.FIREBASE_ON, firebase, fb, env.console, ex);
  return { run: ex.writeUnits, log, fb };
}

const CH = [
  { key: 'sched|2026-09-10', kind: 'sched', date: '2026-09-10', action: 'upsert', obj: { note: 'a' } },
  { key: 'lane|wireless|abc', kind: 'lane', laneId: 'wireless', date: null, action: 'upsert', obj: { note: 'b' } },
  { key: 'event|2026-09-11|e1', kind: 'event', date: '2026-09-11', action: 'delete', obj: null }
];

// --- what a normal save writes ---------------------------------------------
let e = makeEnv(false);
await e.run(CH);
t('one document per changed unit, not the whole calendar', e.log.set.length === 3);
t('a scheduled post is keyed the way U1Scope keys it',
  e.log.set.some(([id]) => id === 'sched|2026-09-10'));
t('a lane post keeps its lane in the key', e.log.set.some(([id]) => id === 'lane|wireless|abc'));
t('a lane post also carries laneId as a field',
  e.log.set.find(([id]) => id === 'lane|wireless|abc')[1].laneId === 'wireless');
t('a deletion is recorded as an action, not an absence',
  e.log.set.find(([id]) => id === 'event|2026-09-11|e1')[1].action === 'delete');
t('a deletion carries no object', e.log.set.find(([id]) => id === 'event|2026-09-11|e1')[1].obj === null);
t('every unit is timestamped server-side', e.log.set.every(([, d]) => d.at === '__ts__'));
t('the batch is committed once', e.log.committed === 1);
t('nothing is deleted on a first write', e.log.delete.length === 0);

// --- an editor who undoes a change -----------------------------------------
// The unit left behind would describe an intent that no longer exists, which is
// worse than a missing one.
await e.run([CH[0]]);
t('undoing a change deletes the units that no longer apply', e.log.delete.length === 2);
t('and leaves the one still changed alone', !e.log.delete.includes('sched|2026-09-10'));
t('the tracked key set shrinks to match', e.fb.lastUnitKeys.length === 1);

// --- a lane id with a slash would create a nested path, not a document ------
e = makeEnv(false);
await e.run([{ key: 'lane|wireless|a/b', kind: 'lane', laneId: 'wireless', action: 'upsert', obj: {} }]);
t('a slash in a generated id is encoded, not left to split the path',
  e.log.set[0][0] === 'lane|wireless|a%2Fb');
t('but the key field keeps the real value', e.log.set[0][1].key === 'lane|wireless|a/b');

// --- it must never break a save that works ---------------------------------
e = makeEnv(true);
let threw = false;
try { await e.run(CH); } catch (x) { threw = true; }
t('a failed unit write does not throw into the save path', !threw);

e = makeEnv(false);
t('a null change log is ignored rather than crashing',
  await (async () => { try { await e.run(null); return true; } catch { return false; } })());
t('and writes nothing', e.log.set.length === 0);

// --- the existing save is untouched ----------------------------------------
t('the whole-state payload still carries state', /state: state,/.test(src));
t('the whole-state payload still carries baseState', /baseState: fb\.baseState \|\| null,/.test(src));
t('units are written AFTER the main save resolves, never instead of it',
  /\.then\(function \(\) \{ updateModeIndicator\(\); writeUnits\(payload\.changes\); \}\)/.test(src));
// Reversibility is the whole point of step 2, so it is asserted rather than
// assumed: exactly one mention of the collection, and it is the write.
const unitMentions = (src.match(/collection\('units'\)/g) || []).length;
t('the units collection is mentioned exactly once in the app', unitMentions === 1);
t('and that one mention is the write, so nothing consumes units yet',
  /var col = firebase\.firestore\(\)[\s\S]{0,0}/.test(src) === false
  && /\.collection\('units'\);/.test(src));


// --- units orphaned by an earlier session -----------------------------------
// The delete pass used to trust an in-memory key list, which does not survive a
// reload. Found in production 2026-09-02: an editor's post was discarded, she
// reloaded, and the unit for it stayed behind because the tracking had reset.
// The whole point of a unit is that it outlives the session, so the first write
// of a session now reconciles against what is really stored.
e = makeEnv(false, ['event|2026-09-02|orphan', 'sched|2026-09-10']);
await e.run([CH[0]]);   // only sched|2026-09-10 is still a real change
t('an orphan from a previous session is found and deleted',
  e.log.delete.includes('event|2026-09-02|orphan'));
t('a unit that is still a real change is left alone',
  !e.log.delete.includes('sched|2026-09-10'));
t('the session now knows its keys', e.fb.unitKeysKnown === true);
t('and tracks only what is currently changed', e.fb.lastUnitKeys.length === 1);

// The reconcile is once per session, not once per save.
const before = e.log.delete.length;
await e.run([CH[0], CH[1]]);
t('a later write does not re-read the collection', e.log.delete.length === before);

// --- when the reconcile itself fails ----------------------------------------
// The writes it was guarding still matter, and the session must not claim to
// know keys it never read, or the next save would delete from a guess.
e = makeEnv(false, ['event|2026-09-02|orphan'], true);
await e.run(CH);
t('a failed reconcile still commits the unit writes', e.log.committed === 1);
t('and says so rather than failing silently',
  e.log.warned.some((w) => /unit reconcile skipped/.test(w)));
t('and does not mark the keys as known, so it retries next time',
  !e.fb.unitKeysKnown);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
