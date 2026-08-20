# Breakthrough findings

## Result

No candidate met the evidence bar for a large TypeAgent improvement.

The datasets expose real product and evaluation problems, but the available
runs do not isolate an output-changing treatment or measure final task
completion. Calling any candidate a breakthrough would overstate the data.

## Measured findings

The saved DroidCall run covers 1,000 independent multi-action training rows,
eight configurations, and seven model IDs.

- TypeAgent pass rate is 56.5% to 62.3%.
- Tool score is 94.92% to 97.96%. Parameter score is 79.95% to 84.55%.
- Adjusted exact accuracy is 56.2% to 58.4%. Adjusted soft accuracy is
  88.17% to 88.95%.
- All eight configurations fail the same 277 rows. An oracle that picks any
  passing configuration reaches 72.3%, but it uses the answer key.
- Gold strings absent from the request occur in 525 rows. Those rows pass at
  36.57% to 48.38%. The other 475 rows pass at 76.42% to 78.53%.
- Plurality voting has 126 ties. Its honest range is 60.2% to 63.4%, compared
  with 62.3% for the best single configuration. It has no measured large gain.

The non-verbatim split mixes valid normalization, generated text, provider
state, ambiguous requests, and bad labels. It is a diagnostic, not a pool of
recoverable failures. Examples include an ISO field whose gold value is
"this Sunday afternoon," invented contact data, and opaque ringtone URIs that
the request and tool catalog cannot determine.

Dependency coverage is also large in these datasets but unmeasured at runtime.
DroidCall has 1,151 dependency-bearing rows among 2,682 multi-action rows.
Seal-Tools has 27 whole-value references and one embedded semantic reference
among 498 multi-action rows. This is dataset coverage, not production traffic.
The existing TypeAgent score excludes these rows and the runner does not
execute providers.

The ten-row DroidCall dependency probe is negative evidence. Released exact
accuracy is 10%, tool F1 is 72.34%, five rows emit `pendingRequestAction`, one
emits `$result`, and one has a translation error. TypeAgent excludes all ten
from its supplemental score. The probe does not execute actions, so it cannot
show whether any plan completes the request.

## Rejected candidates

| Candidate                        | Reviewer verdicts | Reason                                                                                                      |
| -------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------- |
| Semantic argument compiler       | 3 REJECT          | No compiler treatment, paired run, provider execution, or measured gain                                     |
| Typed dependent-dataflow path    | 3 REJECT          | TypeAgent already has partial result support; the benchmark excludes and does not execute dependencies      |
| Executable constraint evaluation | 3 REJECT          | Useful benchmark repair, but no frozen provider contract, output-changing treatment, or causal product gain |

The reviews are under `reviews/`. They include concrete falsification tests and
also caught analysis errors. The current report preserves parameter-array
order in plurality signatures, uses action-local grounding labels, separates
seven models from eight configurations, labels adjusted scores correctly, and
reports Seal-Tools whole-value and embedded references separately.

## What would change this result

The next useful test is a sealed 20 to 24 row screen, not another full benchmark
run. Freeze provider contracts, fixture state, clock, and final-state checks
before opening model outputs. Keep ambiguous or invalid gold in the denominator
as unscorable. Score the same outputs with the current scorer, executable
constraints, and blind human review.

That screen can validate the evaluator. A TypeAgent claim still needs one
predeclared runtime change and a paired rerun on the same sealed rows. Require
at least three more completed tasks out of 24, no loss of user-specified
constraints, and no extra side effects. A score increase caused only by
relabeling existing outputs is benchmark repair.
