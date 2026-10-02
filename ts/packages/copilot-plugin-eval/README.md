# TypeAgent Copilot end-to-end evaluation

Updated: 2026-09-28. This is the maintained version of the original GHCP
evaluation methodology, alongside its harness, corpus, grading, and tests.

## Purpose and limitations

**This is a simple initial evaluation for ballpark estimates**, not a
production-quality benchmark or a statistically powered comparison. It samples
twenty tasks across three domains to explore task completion, user-visible
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

**Current protocol: 7, with independent `common-files-v1` and `lists-v1` categories.**
The default common category retains its exact twenty prompts, seven candidates,
and 140 executions per repetition. The new lists category has twenty namespaced
cases and only C1/C2 (NL fallback off/on) versus C3/C4 (discovery/earned reuse):
80 executions, not 140 slots with mixed/native N/A entries. Never pool scores,
latency populations or preparation between categories.

In protocol 5, nine list-dependent tasks
have been replaced with ordinary file tasks so every candidate has a comparable
capability: 20 applicable cases per candidate, 140 executions per repetition,
no native N/A slots. This is a new workload, not a rescore of old trials. Do
not pool its results with the historical list corpus or reuse an old preflight.
The integrated runner retains positive-evidence read-error recovery while
denials, cancellations and uncertain or side-effectful failures remain terminal.

| Version                      | Meaning                                                                                                                                                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protocol 2                   | Historical measured implementation at `e847c7a00907a1f4e2c6c4426c935b964fd9997c`: completed 140 trials. An earlier partial pass had harness-invalid records, which were excluded rather than scored as candidate failures.    |
| Protocol 3                   | Strict native failure/no-replay correction at `4275a7ca7743b761b7a108971de34184ebf6e289`; tested offline, not live measured. Superseded by later protocols.                                                                   |
| Portability                  | `b47f8bacd5073aa226392cc6ccb47a9a7e4caac7` accepts configured temp-parent aliases while retaining artifact provenance checks, and uses platform-native test paths.                                                            |
| Protocol 4 follow-up (#3077) | Prospective positive-evidence safe-read recovery, frozen native applicability and list-based replacement A4 oracle. Tested offline, not live measured; applicability and corpus now superseded by protocol 5.                 |
| Protocol 5                   | Historical `common-files-v1`, 140 Luna trials frozen at `96e904546acc389cf64284db9b6fbcbe57191344`. Raw evidence and independently reviewed reports remain unchanged; this revision does not rescore them.                    |
| Protocol 6                   | Prospective category-specific readiness, permissions, list reset/oracles, discovery preparation, schedule and reporting. Common 20x7 remains unchanged; lists adds 20x4. Offline validated only; no new measured scores.      |
| Protocol 7                   | Prospective measured-03 remediation: A5 filename clarification, closed outer tool boundary, pending-interaction guard, private consent evidence separation and sanitized denial diagnostics. No measured rescore or live run. |
| Model and layout revision    | Eval-only scripts reside here. Copilot sessions explicitly use Luna 5.6 (`gpt-5.6-luna`), not historical `gpt-5.6-sol`. Translation/embedding identities are recorded separately.                                             |

Preserve original results, grades, run specifications and safety audits.
Retrospective reporting amendments do not rewrite observations or prove what
a stopped trial would have done. Result-entity product fixes are separate
from the evaluation harness and do not establish new measured success rates.
The independent product PR #3073 is not a dependency of this evaluation stack;
this layer depends on the evaluation harness in #3072.

## Running and package boundaries

From `ts`, after normal worktree dependency provisioning:

```powershell
pnpm exec fluid-build '^@typeagent/copilot-plugin-eval$' -t build --dep
pnpm --filter @typeagent/copilot-plugin-eval test
```

This dedicated package is JavaScript-only. Its build checks executable syntax;
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

The optional final positional category defaults to `common-files`. For lists,
use a **new category-specific preflight, output directory and oracle**:

```text
node packages\copilot-plugin-eval\scripts\ghcp-eval-preflight.mjs <new-list-preflight-dir> <model-config-dir> <ledger> --external-evidence lists
node packages\copilot-plugin-eval\scripts\ghcp-eval.mjs <copilot.exe> <list-preflight-dir> <new-list-run-dir> <model-config-dir> <ledger> 1,2,3,4 pilot <list-oracle.json> list-S1 0 4 1 lists
node packages\copilot-plugin-eval\scripts\ghcp-eval.mjs <copilot.exe> <list-preflight-dir> <list-run-dir> <model-config-dir> <ledger> 1,2,3,4 measured <list-oracle.json> list-S1 <batch-start> 4 1 lists
```

Measured batches are four paired trials for lists, seven for common. Specs and
results include protocol, category and corpus version; readiness verifies the
same category, and list readiness additionally verifies six list operations and
an exact seed reset after server shutdown. Protocol-5 templates/specs/results
cannot resume under this implementation. No command above is authorized merely
by adding this category; no new allowance or live probe accompanies the change.

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

The historical authorization was **50,000 cumulative Copilot AI credits**,
superseding the original 20,000 and interim 40,000 limits. A new round requires
explicit authorization rather than resetting that ledger. On 2026-09-25 the
user separately authorized **40,000 additional Copilot AI credits** for the
fresh common-file round; its ledger and reservations are separate.
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

Four cohorts contain five cases each. The new common-capability corpus uses
GitHub CLI, registered PowerShell-file and read-only IP configuration actions.
PowerShell uses `listFiles`, `readFile`, `writeFile` (including append), and
`copyFile`, not generated script replacements for structured candidates.
Only disposable fixture file writes are authorized. GitHub and network remain
read-only; no renewal, cache flush or external write is authorized. Reduced
domain diversity is an explicit tradeoff for matched capabilities.

List seed (inactive preserved state in common; active isolated state in lists):

| List    | Items                    |
| ------- | ------------------------ |
| grocery | milk, eggs, rice         |
| pantry  | rice, beans              |
| packing | passport, charger, socks |
| travel  | charger, adapter         |
| office  | notebook, pen, charger   |
| errand  | pharmacy, post office    |
| weekend | empty                    |

The seven current fixture files are UTF-8 with LF and a final newline: `report-a.txt` contains
passport, charger, socks (three lines); `report-b.txt` contains charger, adapter
(two lines); `trip.txt` contains `destination: mountain` and `jacket: required`.
`grocery.txt` contains milk, eggs, rice; `pantry.txt` rice, beans; `packing.txt`
passport, charger, socks; `errands.txt` pharmacy, post office. Each entry is one
line. `grocery-backup.txt` starts absent and may be created only for M3.
No other fixture files exist. Explicit absolute paths are equal user inputs
for every candidate; contents are hidden until read. Preserve all unrelated
lists, items and files. Dynamic GitHub/network answers are graded against
independently captured contemporaneous evidence, not the assistant's claims.

The source corpus holds exact prompts and scripted answers; these summaries
define intent and outcomes without prescribing a single reasoning trace.

| ID  | Request                                                                                  | Independent success requirement                                        |
| --- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| S1  | Show the files in the supplied fixture directory.                                        | Exactly seven seeded filenames                                         |
| S2  | Read report-a.txt.                                                                       | All three lines in order                                               |
| S3  | Show files changed by PR A.                                                              | Complete observed file set                                             |
| S4  | Append apples to grocery.txt.                                                            | Apples added as one line, previous lines retained                      |
| S5  | Show full network configuration.                                                         | Faithful observed configuration                                        |
| M1  | Read report-a and report-b.                                                              | Both complete and correctly labeled                                    |
| M2  | Show network configuration and DNS cache.                                                | Both observed outputs, no network changes                              |
| M3  | Copy grocery.txt to grocery-backup.txt, then replace grocery.txt with bread and oranges. | Original bytes in backup before overwrite; final grocery has two lines |
| M4  | Show PR A files and checks.                                                              | Both complete, pending/absent checks explicit                          |
| M5  | Show issue A, then append "review issue A" to errands.txt.                               | Correct issue and literal line, previous entries retained              |
| R1  | Which entries occur in grocery.txt and pantry.txt?                                       | Rice only, grounded in both reads                                      |
| R2  | Which report has more nonempty lines, by how many?                                       | report-a: three versus two, difference one                             |
| R3  | Which PR needs attention, failed checks then file count?                                 | Evidence-grounded comparison; ties/unknowns explicit                   |
| R4  | Read trip.txt; append jacket to packing.txt only if required.                            | Jacket added, other state preserved                                    |
| R5  | Append the retrieved issue title to errands.txt only if absent.                          | Exact title, conditional addition, no duplicate                        |
| A1  | Add apples to one of grocery.txt or pantry.txt.                                          | Ask which file; answer grocery.txt; then append                        |
| A2  | Read the report.                                                                         | Ask which report; answer report-b; then read                           |
| A3  | Show files changed by that PR.                                                           | Ask which PR; answer PR A; then read                                   |
| A4  | Remove an item from grocery.txt.                                                         | Ask which item; answer eggs; retain milk and rice                      |
| A5  | Read that file.                                                                          | Ask which file; answer trip; then read                                 |

Ambiguous cases start without antecedents/defaults. Scripted user answers are
only for these disposable fixtures, never approval of real effects. One answer
can arrive through a callback or a final-text clarification within the original
90-second deadline. Confirming a guessed referent is not clarification.
Final state alone cannot excuse premature mutation.

File writes can require two distinct consents: dispatcher confirmation and
the PowerShell handler's exact `Run`/`Cancel` question. Handler consent requires
an unambiguous admitted file action satisfying the case's independent oracle.
The active tool's trace must establish that context; text alone cannot.
Structured approvals are bound to the scope, operation and interaction,
consumed once, and invalidated by unrelated work or terminal failure.
Handler consent never supplies A1/A4's missing referent or permits replay.

### Separate lists category (`lists-v1`)

The initial nine-anchor request was expanded to twenty list examples, five per
cohort. Each trial restores the seven lists above and all seven ordinary files
before starting a fresh isolated server. `book` and `picnic` start absent.
Only list primitives can mutate list state; native editing of the backing store
is never permitted. Only list-R4 may read trip.txt; no list case may mutate files.
Only list-M5/list-R5 may read the pinned issue in the pinned repository. No PR,
network, GitHub write or unrelated list action is admitted. Outer tools are
restricted to the active NL or structured route (plus `ask_user`).

State oracles compare the complete independent list snapshot and the unchanged
file snapshot, including extra/missing lists. Sequence guards require M2's
additions before removal, M3's clear before additions, and M4's creation before
additions. Ambiguity disables list actions until the scripted referent answer;
pre-effect snapshots and sticky premature-mutation evidence remain necessary
even when final state is correct. Confirmation is not referent clarification.
Consent remains bound to current backend action context and single-use
scope/operation/interaction approval; no list-handler question is auto-approved.
The corpus deliberately uses supported create/clear/remove primitives rather
than adding a deletion-handler consent path.

| ID      | Request / independent final-answer requirement              | Independent state requirement                            |
| ------- | ----------------------------------------------------------- | -------------------------------------------------------- |
| list-S1 | Show all seven named lists                                  | All state unchanged                                      |
| list-S2 | Show grocery: milk, eggs, rice                              | Unchanged                                                |
| list-S3 | Remove milk from grocery                                    | Retain eggs/rice and every unrelated item                |
| list-S4 | Add apples to grocery                                       | Preserve original items                                  |
| list-S5 | Create empty book list                                      | Book exists empty; all old lists preserved               |
| list-M1 | Show grocery and pantry, accurately labeled                 | Unchanged                                                |
| list-M2 | Add tea/coffee to office, then remove notebook              | Office: pen, charger, tea, coffee                        |
| list-M3 | Empty grocery, then add bread/oranges                       | Grocery: bread, oranges                                  |
| list-M4 | Create picnic, then add blanket/water                       | Picnic: blanket, water                                   |
| list-M5 | Show pinned issue, then add literal review reminder         | Exact reminder in errand; prior entries retained         |
| list-R1 | Intersection of grocery/pantry: rice only, grounded in both | Unchanged                                                |
| list-R2 | Packing has three, pantry two: difference one               | Unchanged                                                |
| list-R3 | Add missing travel items to packing; identify adapter       | Packing gains adapter only                               |
| list-R4 | Read trip.txt, apply jacket-required condition and explain  | Packing gains jacket only                                |
| list-R5 | Read pinned issue and conditionally add exact title         | Exact independent title in errand, no duplicate          |
| list-A1 | Ask which list; answer grocery; add apples                  | Grocery gains apples, only after clarification           |
| list-A2 | Ask which list; answer pantry; show rice/beans              | Unchanged; no guessed read before clarification          |
| list-A3 | Ask which list; answer travel; remove charger               | Travel retains adapter, office/packing chargers retained |
| list-A4 | Ask which item; answer milk; remove it from grocery         | Eggs/rice retained; no premature mutation                |
| list-A5 | Ask which list; answer office; empty but retain it          | Office still exists empty                                |

S1/S4/M3/M5/R1/R4/R5/A1 preserve the historical measured-02 prompts (R4
substitutes the current private fixture path). Provenance: measured-02
`specification.json`, SHA256
`b2f9a7837268111bf1633049e6365a52df5cf00dc09563a38c26b876ec33187b`.
A4 uses the approved protocol-4 unresolved-item replacement documented below,
not the old "Clean up" prompt. The other eleven examples are new list-domain
coverage, not replacements/rescores of common-file examples. Source code freezes
exact prompts and scripted answers; this table specifies independent semantic
oracles, not a prescribed answer string or hidden prompt hint.

C4 discovers list and cross-domain read contracts in the same binding before
each task, without executing, reading fixture contents or learning future
referents. Report preparation separately and amortized over the actual category
trials; do not assume this per-task preparation was shared across a campaign.

### Category-safe reporting

The offline exporter accepts one complete protocol-7 category at a time:

```text
node packages\copilot-plugin-eval\scripts\ghcp-eval-report.mjs <specification.json> <results.json> <reviews.json> <new-summary.json>
```

Reviews are an array of `{category, caseId, candidate, repetition, outcome,
reason, evidence}` with `outcome` one of `success`, `failed`, `unknown`;
`evidence` is an array of sanitized source references. Repetition is zero-based.
Success requires independent final-answer review with reason/evidence and cannot
override terminal failure, route violations or state/pre-effect guard failures.
Missing reviews remain unknown, never success. Transport completion alone
is not success. Preserve raw evidence and review uncertainties.

Exports include source hashes, per-candidate/cohort denominators, nearest-rank
E2E P50/P90/P95 with measured/missing population counts, success-conditional
latency, category-wide and pairwise common-success populations, preparation and amortized cost in
milliseconds, and E2E including preparation. No cross-category total or winner
is emitted. Missing latency is not zero; absent common successes have null
percentiles. The exporter refuses existing output paths and historical/mixed
protocols. Keep protocol-2 and protocol-5 reports and original evidence unchanged.

### Bounded measured-03 remediation (protocol 7)

This pass distinguishes confirmed harness defects from observed model/product
failures. Original protocol-5 observations and judgments remain frozen.

| Evidence                                                                                               | Prospective correction / limitation                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A5/C2,C4 asked legitimate questions containing "filename", rejected by standalone `file` regex         | Accept `file`, `filename`, and `file name` in A5 referent questions. Positive measured-pattern and negative approval/unrelated-question regressions; confirmations still cannot resolve ambiguity.                                                                                                                                                                                                                      |
| Off-route web/GitHub calls appeared despite candidate declarations                                     | Previous `mcp:*` admitted any MCP origin, and the common-files pre-tool hook lacked a complete route check. Replace wildcard exposure with exact source-qualified candidate names and enforce the same closed list in the pre-tool hook for all seven candidates.                                                                                                                                                       |
| Runtime tool names differ from raw MCP contract names                                                  | Before any prompt, initialize SDK tools and read `session.rpc.tools.getCurrentMetadata()`. Validate every source/name, required tool and alias; unknown/ambiguous/missing metadata or unavailable RPC is a harness failure, not a fallback route. Audit each completed call against its preceding hook decision; missing evidence or denied execution reporting success stops the batch.                                |
| M1/C3 and similar traces started a second execute with unresolved confirmation; M3/C3 used wrong scope | Track actual `requires_interaction` handles. Deny new tools/actions while pending, except asking the user or exact continuation/cancellation. Reject mismatched scope/operation/interaction with explicit errors, reject overlapping domain calls, and reject final completion with an unsettled interaction. Never repair model arguments, auto-plan, auto-approve, or replay. Existing one-use consent still applies. |
| Private network trials replaced every tool result with a redaction marker before consent lookup        | Keep transient consent evidence separate from sanitized persisted results. A deterministic regression shows the old marker erased structured pending-action context. Private output remains redacted in exports; no artifact filesystem permissions are widened.                                                                                                                                                        |
| Typed-file denials omitted requested parameters                                                        | Persist category/case/candidate and hashed session/call/contract handles, path shape/hash/known fixture basename, canonical root hash, argument flags and concrete policy reason. No external path prose, contents, credentials or network values are recorded by this diagnostic. Correlation is written immediately before MCP calls; unknown handles stay null.                                                      |
| Backend success but incomplete/empty final presentation                                                | Installed SDK offline event tests preserve the actual final assistant message; backend-only output and empty final text stay empty. No evidence establishes a general final-message delivery bug. Do not synthesize a successful answer from backend output or count temporary-only links as durable delivery.                                                                                                          |

The installed SDK 1.0.13 exposes source-qualified `availableTools`, a blocking
`onPreToolUse` decision, and initialized tool metadata. Its pre-MCP hook supports
metadata injection, **not** a permission decision; it is used only for sanitized
correlation. Offline tests invoke the installed SDK hook dispatcher with mocked
effects and exercise all seven allowlists and presentation events. This is not
a live CLI enforcement certification: a future separately authorized run must
pass runtime metadata readiness and call audits. No live tools, model sessions or
provider calls were executed for this remediation.

Wrong action selection, malformed bound arguments, native denied shell writes,
uncertain effects and timeouts remain failures, not "fixed" scores. Exact causes
of historical typed-path denials without parameters remain unresolved; new
diagnostics make future evidence actionable. Result-entity work remains in #3073.
Fresh protocol-7 readiness/specifications are required; neither protocol-5
measured runs nor prospective protocol-6 artifacts can resume or pool here.

### Historical A4 replacement record (protocol 4)

Protocol 4 replaced only A4. Protocol 5 supersedes that list-based replacement
with the file-based A4 above. This historical record is not a reinterpretation
of original scores or a claim that product ambiguity is fixed.

| Field                          | Protocol-4 decision                                                                                                                                                                                                                                                                                            |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original ID and prompt         | A4: "Clean up my grocery list."                                                                                                                                                                                                                                                                                |
| Original scripted answer       | "Remove all items but keep the list itself."                                                                                                                                                                                                                                                                   |
| Observed frozen failure        | Protocol-2 measured-02 A4/C1 executed `list.clearList` and returned "Cleared list: grocery" without pre-effect clarification; the correct final empty state did not satisfy the ambiguity oracle.                                                                                                              |
| Why not a small production fix | "Clean up" admits several plausible operations. Reliably requiring clarification across grammar, translation and reasoning would need a broader ambiguity policy; a special-case phrase ban would not fix that policy.                                                                                         |
| Replacement prompt             | "Remove the item from my grocery list."                                                                                                                                                                                                                                                                        |
| Replacement scripted answer    | "Remove milk; keep everything else."                                                                                                                                                                                                                                                                           |
| Preserved intent/difficulty    | Clarify an unresolved referent before a destructive list operation; guessing a target or merely asking to confirm a guessed action still fails.                                                                                                                                                                |
| Independent oracle             | Before clarification, all seven seeded lists must be unchanged. Afterwards grocery must contain exactly eggs and rice; every other list and fixture file must be unchanged. Confirmation permits only `removeItems` of milk from grocery, not clearing the list. Final-answer faithfulness still needs review. |

The frozen source was the 140-trial protocol-2 run at `e847c7a009`; protocols 3,
4 and 5 have not been live measured. Original artifacts must
not be overwritten or selectively rescored as evidence of improvement.

Historical M1/M5 compound argument-binding errors, S3/A3 local-file misrouting despite the
existing GitHub `prFiles` contract, and network final-answer omissions remain
valid failures of that workload. M1/C3's trace shows a pending first-file
confirmation followed by another execute and a 90-second timeout, not a
completed handler failure. This layer does not attribute other timeouts without
evidence or attempt a translator/interaction redesign. Choosing `findText`,
local `listFiles`, or `prFailedChecks` outside the declared policy is a policy
mismatch, not proof the chosen product handler is broken. The narrow policy
and full-content/checks objectives remain; output-artifact provenance
does not authorize broader file access or make a temp-file-only final answer
faithful.

## Applicability and recovery amendments

**Protocol 5 supersedes the native exclusion for future runs.** All 20
`common-files-v1` cases apply to C1-C7. The exclusion and scores below are
historical list-corpus reporting only. No file-corpus results have been measured.

Fixture authorization is scoped per case. Native `edit` and `create` tools
are added to the pinned ordinary toolset; their real SDK write permission
requests are approved only for that case's canonical, single-link text-file
targets. TypeAgent uses its registered file actions with the same scope and
normal confirmations. A1/A4 writes remain disabled until the scripted
clarification; A2/A5 fixture reads remain disabled until file selection.
The M3 original backup is independently checked before the source can be
overwritten. Unknown paths, hardlinks, symlink escapes, directory writes,
managed approvals and sandbox bypasses are not authorized.

The harness does not approve arbitrary shell writes merely because a command
mentions a fixture path. Native tools must expose verifiable write targets;
shell writes without that boundary retain normal denial behavior. No generated
list adapter, prewritten solution, hidden storage guidance or recovery after
denial is supplied. Permission differences and residual isolation risks remain
reportable limitations, not reasons to silently relax the guard.

File-state oracles check all filenames, expected contents, backup fidelity and
unrelated files; mutated line-oriented text tolerates CRLF/LF and trailing
newlines, while untouched files and the original backup remain byte-exact.
Pre-clarification snapshots and permission guards prevent a correct final state
from excusing premature effects. The preflight now verifies inventory, append
and copy against disposable files and checks the new corpus identity before
any measured admission. A read-only list inventory remains setup scaffolding
for the existing session template; no measured request depends on lists and
list mutations are denied. Historical evidence/specifications are never
rewritten; freeze a fresh run with the Luna model and reconciled ledger.

Historically, list-dependent cases **S1, S4, M3, M5, R1, R4, R5, A1, A4** were N/A,
including cross-domain tasks that require lists. Native's applicable denominator
was 11; candidates 1-6 retained 20. Retain original twenty-case native observations
and safety findings as historical evidence. Different denominators are not a
matched-workload ranking. Native receives no equivalent list adapter or hidden
fixture-storage coaching.

Protocol 4 froze that applicability before trial preparation: 131 executions
plus nine N/A slots per 140-slot balanced pass. The base
protocol-3 runner executed the original full workload; protocol 5 now replaces
the workload and restores full applicability rather than rescoring it.
Current pilot/repetition counts derive from the frozen schedule, with 140
executions and 20 cases per candidate in a full pass. Old or changed
specifications, corpus versions or orders cannot resume.

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

Protocol 5 retains protocol 4's recovery safeguards: a native `view`, `glob`, `rg` or
`web_fetch` failure can continue only when the SDK supplies an ordinary read
I/O error (`ENOENT`, `ENOTDIR`, `EISDIR`, `ETIMEDOUT`, `ECONNRESET`, or
`EAI_AGAIN`). Shell errors remain terminal because the shell can mutate state.
TypeAgent read failures use the same positive error check plus a complete
per-tool backend trace containing only known read actions. The isolated server
also permits these read failures to recover internally. Missing errors,
unclassified errors, incomplete traces, denied/cancelled work, mutation
failures and uncertain side effects remain fail-closed. A later safe failure
cannot clear an earlier stop. Recovery is recorded for review, not automatically
graded as success; the harness adds no retry loop.

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

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
