# TypeAgent Copilot end-to-end evaluation

Updated: 2026-09-25. This is the maintained version of the original GHCP
evaluation methodology, alongside its harness, corpus, grading, and tests.

## Purpose and limitations

**This is a simple initial evaluation for ballpark estimates**, not a
production-quality benchmark or a statistically powered comparison. It samples
twenty tasks across four domains to explore task completion, user-visible
latency, and workflow overhead. Five cases per cohort and one historical
balanced repetition cannot establish precise tail percentiles, non-inferiority,
or a general winning strategy.

**We acknowledge potential environment-isolation risks from implementing and
running this evaluation alongside the Copilot plugin.** Moving its code into
this separate directory prevents it from being part of the plugin source
layout; it does not create an OS security boundary or prove full isolation.
The harness still reuses plugin staging/discovery infrastructure, the same
host, authenticated CLI, runtime dependencies, model configuration, and
read-only external services. Native tools and inherited process configuration
can expose environmental differences. Shared caches, provider behavior and
changing GitHub/network data can confound comparisons. This implementation is
aware of these limitations; isolated fixtures, scoped permissions, private
data/temp directories and trace audits mitigate them but do not eliminate them.
Never describe this implementation as a sandbox or isolation certification.

Only actual Copilot SDK conversations count as end-to-end trials. A supplied
correct action, mocked model selection, discovery smoke test or dispatcher
microbenchmark is not a substitute. Throughput/load tests, cold-start campaigns,
Direct-hook comparisons and a broad adversarial suite are outside this initial
scope. Weather is removed and calendar is deferred.

## Implementation and protocol history

| Version                      | Meaning                                                                                                                                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protocol 2                   | Historical measured implementation at `e847c7a00907a1f4e2c6c4426c935b964fd9997c`: completed 140 trials. An earlier partial pass had harness-invalid records, which were excluded rather than scored as candidate failures. |
| Protocol 3                   | Strict native failure/no-replay correction at `4275a7ca7743b761b7a108971de34184ebf6e289`; tested offline, not live measured. This base runner still uses that policy.                                                      |
| Portability                  | `b47f8bacd5073aa226392cc6ccb47a9a7e4caac7` accepts configured temp-parent aliases while retaining artifact provenance checks, and uses platform-native test paths.                                                         |
| Protocol 4 follow-up (#3077) | Prospective positive-evidence safe-read recovery, frozen native applicability and replacement A4 oracle. Kept in its separate dependent PR; do not infer its runtime behavior from this base runner.                       |
| Model and layout revision    | Eval-only scripts now reside here. Future Copilot sessions explicitly use Luna 5.6 (`gpt-5.6-luna`), not the historical `gpt-5.6-sol`. No Luna rerun or improved measured outcome is claimed.                              |

Preserve original results, grades, run specifications and safety audits.
Retrospective reporting amendments do not rewrite observations or prove what
a stopped trial would have done. Result-entity product fixes are separate
from the evaluation harness and do not establish new measured success rates.

## Running and package boundaries

From `ts`, after normal worktree dependency provisioning:

```powershell
pnpm exec fluid-build '^@typeagent/copilot-plugin-eval$' -t build --dep
pnpm --filter @typeagent/copilot-plugin-eval test
```

The package is private and JavaScript-only. Its build checks executable syntax;
dependency-aware builds prepare the plugin, dispatcher and agent-server.
Tests are offline. Plugin installation/bundling does not include this harness.
`copilot-plugin/scripts/discovery-e2e.mjs` remains shared plugin test
infrastructure; dispatcher-side permission, credit and artifact guards stay
at their actual runtime enforcement boundaries rather than moving into a
client-only package.

Live commands below require separate authorization, an authenticated Copilot
executable, existing model configuration, a reconciled model-specific credit
ledger, and verified handlers/catalog. They can incur model usage; building or
testing this package does not run them.

```text
node packages\copilot-plugin-eval\scripts\ghcp-eval-preflight.mjs <new-preflight-dir> <model-config-dir> <ledger> --external-evidence
node packages\copilot-plugin-eval\scripts\ghcp-eval.mjs <copilot.exe> <preflight-dir> <run-dir> <model-config-dir> <ledger> <candidate-ids> pilot <oracle.json> <case-ids>
node packages\copilot-plugin-eval\scripts\ghcp-eval.mjs <copilot.exe> <preflight-dir> <run-dir> <model-config-dir> <ledger> 1,2,3,4,5,6,7 measured <oracle.json> S1 <batch-start> 7 1
node packages\copilot-plugin-eval\scripts\ghcp-credit-probe.mjs <copilot.exe> <ledger> <new-probe-dir>
```

Use nonsynchronized local directories for live databases and locks. Preserve
sanitized results and specifications in durable storage afterwards. The oracle
JSON pins issue/PR evidence and a relative `readinessFile` naming a successful
preflight. The current concrete GitHub inputs are PRs 3058/3067 and issue 2617
in microsoft/TypeAgent; verify availability and contemporaneous evidence before
a new run. Do not silently replace targets during a frozen run.

## Explicit model and admission

`scripts/ghcp-eval-config.mjs` pins **Luna 5.6, `gpt-5.6-luna`**. The measured
outer conversation, same-binding contract preparation, and TypeAgent nested
Copilot reasoning use this identity. Preflight and the optional credit probe
also enforce it. Main trials keep high reasoning effort; the small accounting
probe uses low effort. TypeAgent translation and embedding providers remain
separately configured and must be recorded; this pin does not silently change
their model identities.

Every entry point rejects a mismatched ledger before starting services or model
work. Do not relabel a historical Sol ledger or assume its per-request bounds
apply to Luna. Verify current model availability, credit rates, context/output
bounds and nested-request accounting; reconcile cumulative prior charges in a
new run specification. An unavailable model is a blocker, not permission to
substitute one. No live availability/pricing probe is part of this migration.

The authorized ceiling is **50,000 cumulative Copilot AI credits**, superseding
the original 20,000 and interim 40,000 limits, not a fresh allowance per run.
Include planning, implementation, preparation, pilots, failed/cancelled work,
nested reasoning, grading and reporting. Reserve report headroom, retain
unsettled maximum reservations and stop new admissions if accounting is unclear.
Externally billed translation/embedding usage is reported separately; unknown
usage is not zero. This is not a general-purpose pricing or billing-hard-stop
service.

The proxy reserves before forwarding, settles explicit billing fields, rejects
model mismatches/WebSockets and retains unknown charges. Limits include 24
requests per scoped session and 2,000 cumulative ledger requests. The SDK
60-credit session limit is additional and **soft**, not the hard admission
mechanism. Historical request reservations are not certified bounds for Luna.
Moving code or changing models never reopens a closed ledger.

## Seven candidates and fallback

| #   | Candidate                           | Allowed outer entry                                                                            |
| --- | ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | NL-MCP, fallback disabled           | `typeagent-processCommand` only                                                                |
| 2   | NL-MCP, fallback enabled            | Same as 1                                                                                      |
| 3   | Structured discovery                | `searchActions`, `executeAction`, structured continuation/cancellation; never `processCommand` |
| 4   | Structured current-contract reuse   | Same structured surface; contracts earned by discovery earlier in the same binding             |
| 5   | Production mixed, fallback disabled | NL and structured interfaces under production routing guidance                                 |
| 6   | Production mixed, fallback enabled  | Same as 5                                                                                      |
| 7   | Native Copilot only                 | Pinned native tools; no TypeAgent plugin, hooks, tools, guidance or special storage access     |

All TypeAgent candidates use MCP. Direct-hook execution is excluded to keep
transport and the Copilot agent loop comparable; structured tools also exist
in Direct mode but are still MCP tools. Pure candidates neutralize conflicting
plugin guidance and enforce interfaces at the tool boundary. Mixed candidates
retain production guidance. Auxiliary outer workspace/macro/skill MCP servers
are omitted; do not silently alter the internal reasoning toolset.

Fallback means TypeAgent's **failed translation to Copilot reasoning**
transition, controlled by `translationReasoningFallback`. Grammar/cache misses
proceeding to LLM translation, normal action selection, successful-result
reasoning, multi-tool orchestration and outer tool-error recovery are not this
fallback. Preserve grammar/cache/LLM translation in each toggle pair and trace
the actual decision, entry and outcome (`TYPEAGENT_GHCP_EVAL_TRACE`).

Compare 1/3/4 for resolution strategies, 1/2 and 5/6 for fallback, and pure
versus mixed separately. Reuse must not preload answers, exact action arguments
or resolved ambiguous referents. Report discovery preparation separately and
include it in whole-workflow amortization, not just subsequent-turn savings.

## Fixtures, domains and twenty cases

Four cohorts contain five cases each. Domain operations must map to existing
list, GitHub CLI, registered PowerShell-file and read-only IP configuration
actions. PowerShell uses `powershell.powershell-files.readFile`, not generated
script replacements for structured candidates. GitHub and network actions are
read-only; no renewal, cache flush, write or real external effect is authorized.

Seed lists before each trial:

| List    | Items                    |
| ------- | ------------------------ |
| grocery | milk, eggs, rice         |
| pantry  | rice, beans              |
| packing | passport, charger, socks |
| travel  | charger, adapter         |
| office  | notebook, pen, charger   |
| errand  | pharmacy, post office    |
| weekend | empty                    |

Fixture files are UTF-8 with LF and a final newline: `report-a.txt` contains
passport, charger, socks (three lines); `report-b.txt` contains charger, adapter
(two lines); `trip.txt` contains `destination: mountain` and `jacket: required`.
No other fixture files exist. Explicit absolute paths are equal user inputs
for every candidate; contents are hidden until read. Preserve all unrelated
lists, items and files. Dynamic GitHub/network answers are graded against
independently captured contemporaneous evidence, not the assistant's claims.

The source corpus holds exact prompts and scripted answers; these summaries
define intent and outcomes without prescribing a single reasoning trace.

| ID                   | Request                                                  | Independent success requirement                                      |
| -------------------- | -------------------------------------------------------- | -------------------------------------------------------------------- |
| S1                   | Show my lists.                                           | Exactly seven seeded names                                           |
| S2                   | Read report-a.txt.                                       | All three lines in order                                             |
| S3                   | Show files changed by PR A.                              | Complete observed file set                                           |
| S4                   | Add apples to grocery.                                   | Apples added, previous items retained                                |
| S5                   | Show full network configuration.                         | Faithful observed configuration                                      |
| M1                   | Read report-a and report-b.                              | Both complete and correctly labeled                                  |
| M2                   | Show network configuration and DNS cache.                | Both observed outputs, no network changes                            |
| M3                   | Empty grocery, then add bread and oranges.               | Existing grocery contains exactly those two                          |
| M4                   | Show PR A files and checks.                              | Both complete, pending/absent checks explicit                        |
| M5                   | Show issue A, then add "review issue A" to errand.       | Correct issue and literal item, previous items retained              |
| R1                   | Which items are in grocery and pantry?                   | Rice only, grounded in both reads                                    |
| R2                   | Which report has more nonempty lines, by how many?       | report-a: three versus two, difference one                           |
| R3                   | Which PR needs attention, failed checks then file count? | Evidence-grounded comparison; ties/unknowns explicit                 |
| R4                   | Read trip; add jacket to packing only if required.       | Jacket added, other state preserved                                  |
| R5                   | Add the retrieved issue title to errand only if absent.  | Exact title, conditional addition, no duplicate                      |
| A1                   | Add apples to my list.                                   | Ask which list; answer grocery; then add                             |
| A2                   | Read the report.                                         | Ask which report; answer report-b; then read                         |
| A3                   | Show files changed by that PR.                           | Ask which PR; answer PR A; then read                                 |
| A4 (historical/base) | Clean up my grocery list.                                | Clarify operation; answer remove all items but keep list; then clear |
| A5                   | Read that file.                                          | Ask which file; answer trip; then read                               |

Ambiguous cases start without antecedents/defaults. Scripted user answers are
only for these disposable fixtures, never approval of real effects. One answer
can arrive through a callback or a final-text clarification within the original
90-second deadline. Confirming a guessed referent is not clarification.
Final state alone cannot excuse premature mutation.

**Latest A4 follow-up:** protocol 4 replaces only the vague clean-up verb with
an unresolved-item-removal request, then supplies the item after clarification.
Its independent oracle rejects guessed/wrong-item confirmation and premature
mutation even if the final state is correct, and preserves unrelated state.
This avoids conflating verb interpretation with referent resolution; it does
not claim the original product ambiguity is fixed. Original A4 evidence remains
historical. M1/M5/S3/A3 routing issues, timeouts and network presentation failures
are retained as valid failures, not replaced with easier tests.

## Applicability and recovery amendments

Native list-dependent cases **S1, S4, M3, M5, R1, R4, R5, A1, A4** are N/A,
including cross-domain tasks that require lists. Native's applicable denominator
is 11; candidates 1-6 retain 20. Retain original twenty-case native observations
and safety findings as historical evidence. Different denominators are not a
matched-workload ranking. Native receives no equivalent list adapter or hidden
fixture-storage coaching.

Protocol 4 freezes this applicability before trial preparation: 131 executions
plus nine N/A slots per 140-slot balanced pass. Pilot/repetition counts derive
from the schedule; old or changed specifications/order cannot resume. The base
protocol-3 runner still executes the original full workload, so do not claim
the reporting exclusion changes its scheduling.

An ordinary recoverable tool failure alone need not invalidate content-correct
completion. Recovery must stay inside routes, permissions, fixture scope,
confirmations, deadlines and budget. Explicit denials, cancellations and
uncertain side effects remain terminal. Missing error detail is not evidence
of safety. Protocol 4 requires positive SDK evidence for safe read failures and,
for TypeAgent, complete read-only backend events. Denial fields take precedence
over apparently recoverable errors; mutation failures and unknown shell
follow-ups remain terminal. Protocol 3 instead stops on native domain failure
even without an error payload. Neither policy authorizes replay of uncertain
effects or replaces the actual product failure with another action.

Historical strict successes were 6/6/11/11/6/8/3 out of twenty for candidates
1-7. Retrospective content scoring restores only six continuation-penalized
trials: C5 R3; C7 M4/A3/S3/R2/R3. Revised full-workload counts are
6/6/11/11/7/8/8; native applicability gives 8/11, with A2/M2/S5 remaining
non-successes. These are reporting amendments, not new executions or a recovery
safety certification. Original strict success-conditioned timings must not be
attached to the revised score populations without recomputation.

## Experimental controls and measurements

Pin commit, CLI/SDK/plugin versions, model identities, catalog, enabled agents,
native allowlist, permissions and guidance. Run ready services at concurrency
one, with fresh conversations/bindings and restored fixtures. Reset controllable
caches consistently; record grammar/cache hits and provider-cache unknowns.
Candidate 4 alone keeps earned contract context within its binding. Do not
change global registration, shared services, Azure identities or user network.

Preflight verifies real contracts, handlers, auth, storage and output shape
outside measured conversations. A missing prerequisite blocks the run rather
than silently rewriting a case. A supported task that fails remains a failure.
Pilot first, then freeze balanced paired order, seed, repetitions, timeouts,
applicability, configuration/evidence hashes and grading rules. Changes require
a distinct run; preserve partial outcomes and never replay uncertain work.

Measure E2E P50/P90/P95 from accepted prompt through final user-visible outcome.
Separate successful completion from unsuccessful termination and show counts
by candidate/cohort. Report wall time and system-active time with actual human
waiting removed, not model/tool time. Show paired common-success latency only
as a conditional supplement, never as a replacement for applicable accuracy.
Fast refusal is not a speedup.

Capture model invocations, MCP calls, retries, internal translation fallback,
preparation and backend spans. Separate outer and nested invocations. Nested
or overlapping timings are not additive; retain unattributed time. Missing
stages, provider usage and transport retry counts are unknown/null, not zero.

Grade actual state and evidence-grounded final presentation independently,
outside timing. `completed` or `completed_ungraded` is not task success.
Distinguish unsupported, partial, wrong, clarification, timeout, unsafe and
presentation outcomes. Preserve `failed`, `cancelled`, `requires_interaction`,
`unavailable` and `execution_uncertain` statuses. Grade clarification before
execution separately from eventual completion. No unauthorized/duplicate
effects are acceptable even if final text looks correct.

## Artifacts and conclusion

Persist trial/run IDs, frozen specification, routes, parameters, interactions,
cache observations, terminal outcomes, independent grades, timing, credit ledger
and hashes. Private network outputs and raw evidence remain private; public
reports contain sanitized summaries/hashes, not secrets, private paths or
billing traces. SDK overflow artifacts are trusted only from completion notices,
as regular single-link direct children with SDK names and matching content;
hashes are rechecked before reads. Configured temp-root aliases do not authorize
arbitrary paths, subdirectories or unrelated aliases.

The findings report must include coverage, candidate/cohort accuracy and
latency, conditional paired comparisons, discovery amortization, workflow
efficiency, representative failures, budget accounting and limitations.
Separate causal evidence from hypotheses. Keep pilot/harness failures separate
from valid measured outcomes. Report when evidence is insufficient to recommend
a winner; no unrun configuration, Luna comparison or prospective fix is a
measured finding.
