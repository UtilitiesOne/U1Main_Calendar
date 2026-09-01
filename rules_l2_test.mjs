// The proposals-update l2 predicate, reproduced verbatim from
// firestore.rules.merged, tested across the full review lifecycle including
// the second cycle that deadlocked editors on 2026-08-18.
// Run: node rules_l2_test.mjs
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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
