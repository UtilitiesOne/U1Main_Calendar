// The proposals-update l2 predicate, reproduced in JS and tested across the full
// review lifecycle including the second cycle that deadlocked editors on
// 2026-08-18.
//
// The reproduction is the weak point. This suite used to name
// firestore.rules.merged, a file that no longer exists, and never opened any
// rules file at all: change the rule and these cases keep passing against logic
// nobody ships. That is the same shape as merge_test reading a stale copy of the
// app, which was green for weeks while proving nothing (both found 2026-09-01).
//
// So the bottom of this file now checks the reproduction against the real
// firestore.rules text. It cannot execute the rules language, but it can refuse
// to stay quiet when the rule it claims to mirror has moved.
//
// Run: node rules_l2_test.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

function gatePassed(nd) {
  return !('submitted' in nd) || nd.submitted !== true || nd.l1 === 'clean';
}
function editorUpdateAllowed(oldD, newD) {
  if (!gatePassed(newD)) return false;
  return (!('l2' in newD))
      || (('l2' in newD) && ('l2' in oldD) && newD.l2 === oldD.l2)
      || (!('l2' in oldD) && newD.l2 === 'pending');
}
let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log('PASS ', name); } else { fail++; console.log('FAIL ', name); } };

// Cycle 1: fresh doc, clean submit from the NEW client (no l2 in payload).
t('cycle 1: clean submit, no l2 in payload, no l2 on doc',
  editorUpdateAllowed({ submitted: false, l1: 'unchecked' }, { submitted: true, l1: 'clean' }));

// Runner stamps l2:'done' (service account, bypasses rules). Then:
const reviewed = { submitted: true, l1: 'clean', l2: 'done' };

// Cycle 2, THE deadlock case, now the new client omits l2 entirely:
t('cycle 2: edit autosave after review (no l2 in payload) is ALLOWED',
  editorUpdateAllowed(reviewed, { submitted: false, l1: 'clean' }));
t('cycle 2: clean resubmit after review (no l2 in payload) is ALLOWED',
  editorUpdateAllowed(reviewed, { submitted: true, l1: 'clean' }));

// The old client behavior that caused the deadlock stays refused (documented):
t('old client echoing stale pending over done stays DENIED',
  !editorUpdateAllowed(reviewed, { submitted: true, l1: 'clean', l2: 'pending' }));

// Forgery stays impossible:
t('editor cannot SET l2 done on an unreviewed doc',
  !editorUpdateAllowed({ submitted: true, l1: 'clean' }, { submitted: true, l1: 'clean', l2: 'done' }));
t('editor cannot CHANGE l2 done to pending explicitly',
  !editorUpdateAllowed(reviewed, { submitted: false, l1: 'clean', l2: 'pending' }));
t('echoing the same value is still fine (transition compat)',
  editorUpdateAllowed(reviewed, { submitted: false, l1: 'clean', l2: 'done' }));

// The gate floor is untouched:
t('unstamped submit still refused', !editorUpdateAllowed(reviewed, { submitted: true, l1: 'unchecked' }));


// --- the reproduction must still match the rule it claims to mirror ---------
// Executing the rules language is not possible here, but drift is detectable:
// if the predicate in firestore.rules no longer has the shape reproduced above,
// these cases are testing something the server does not do, and a green run is
// worse than no run.
const RULES = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'firestore.rules'), 'utf8');

t('the rules file is actually opened by this suite', RULES.length > 0);
t('gatePassed still exists server-side', /function gatePassed\(\)/.test(RULES));
t('gatePassed still keys on submitted plus l1 == clean, as reproduced above',
  /!\('submitted' in request\.resource\.data\)[\s\S]{0,200}?submitted != true[\s\S]{0,200}?l1 == 'clean'/.test(RULES));
t('create still refuses any l2 other than pending, as reproduced above',
  /allow create:[\s\S]{0,400}?!\('l2' in request\.resource\.data\)[\s\S]{0,120}?l2 == 'pending'/.test(RULES));
t('update still lets an editor omit l2 (the 2026-08-18 deadlock fix is still in)',
  /allow update:[\s\S]{0,900}?\(!\('l2' in request\.resource\.data\)\)/.test(RULES));
t('update still forbids an editor SETTING l2 to a value of their choosing',
  /\('l2' in request\.resource\.data\) && \('l2' in resource\.data\)/.test(RULES));
t('the owner override is still there', /request\.auth\.token\.email == "wakroz@gmail\.com"/.test(RULES));
t('the allowlist still gates create and update',
  (RULES.match(/isApprovedEditor\(\)/g) || []).length >= 2);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
