# Decisions Prototype

Runs `gpt-6-luna-decisions` through TypeAgent AI Client's Copilot provider by
default. Microsoft-Decision-1 on Azure remains an optional comparison backend.
This is an isolated experiment, not a change to dispatcher behavior.

## Latest Results

The **2026-10-14 provider comparison** completed 46 live jobs: the same 15
applicable scenarios against Copilot Luna, Azure Decision-1 East US and Azure
Decision-1 Sweden Central, plus one `gpt-5-mini` generative-only control.
The 458 planned case records are not 458 inference calls. Both configured native
Azure URLs are correct without a deployment path segment; the deployment belongs
in the request's `model` field. Local config was not changed.

The [full comparison report](../../../../codeDocs/TypeAgent/forAgent/investigations/completed/2026/2026-10-14_decision-model-provider-comparison.md)
contains all scenario outcomes, exact failure IDs, timing caveats, source-grounded
integration recommendations and reproduction details. Raw source-hashed evidence
and generated metrics remain locally under `results/2026-10-14-provider-comparison-124108/`.

| Experiment                         | Copilot Luna              | Decision-1 East US           | Decision-1 Sweden Central         |
| ---------------------------------- | ------------------------- | ---------------------------- | --------------------------------- |
| MCP flat, validated label matches  | 31/32; one failure        | 31/32                        | 31/32                             |
| Dispatcher flat                    | 24/26                     | 24/26                        | 24/26                             |
| Retrieval informative mean NDCG    | 0.9982                    | 0.9964                       | 0.9964                            |
| Verification choice                | 22/24                     | 22/24                        | 22/24                             |
| Workflow including the no-fit gate | 15/24; one refusal        | 12/24                        | 11/24                             |
| Shopping / hybrid shopping         | Both 2/2 verified         | Same                         | Same                              |
| Realistic Crossword 2              | All four scenarios passed | Same                         | Same                              |
| Legacy crossword                   | 2/2 verified              | 2/2 verified                 | Read passed; fill safely declined |
| Read-only commerce                 | No-fit                    | Search executed; no mutation | Search executed; no mutation      |
| Hybrid commerce                    | Fit-gate abstention       | Same                         | Same                              |

Failures that return no-fit are not counted as correct labeled abstentions.
Three jobs exited nonzero, but even zero exits can contain semantic misses or
safe abstentions. No prompts or thresholds were retuned. All realistic crossing
conflicts were rejected by the host, and all browser executor-model counts were
zero. Shopping hybrids made no chat calls, so live fallback was not exercised.
No new videos were recorded and old recordings are not Decision-1 evidence.

Next investigate **read-only shadow selection in live TypeAgent**, preserving
clarification, eligibility, typed translation, approvals and host execution.
Reranking warrants a separate actual-baseline comparison. Missing-evidence false
confirmations and weak workflow results block automatic adoption. These are
single-pass development observations, not calibration or speedup benchmarks.

Run the small [comparison collector](compare-providers.mjs) from the repo root:

```powershell
if (Test-Path $PROFILE) { . $PROFILE }
node ts/examples/decision/compare-providers.mjs --live --dry-run
$output = Join-Path 'ts/examples/decision/results' ('provider-comparison-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
node ts/examples/decision/compare-providers.mjs --live --output-dir $output --chat-model gpt-5-mini
```

Use an authenticated installed Copilot CLI and the configured Azure identity.
Add `--cli-path` only when necessary. The directory must be fresh. The collector
continues after failed jobs and preserves their evidence without rerunning them;
inspect case outcomes rather than treating its completion as an all-pass signal.
Each individual decision/hybrid runner accepts `--provider azure --model <actual-deployment-name>
--region <configured-region>`; commerce retains its existing single-live-case cap.

Final verification passed **110 offline tests**, the affected build, pinned
formatting, and report YAML/local-link checks. Scoped scans covered all 59
source/test files, including the untracked collector: only five existing
`main.mjs` no-console findings and four existing over-budget functions remain.
Circular/debt checks passed, but Git-based changed-source gates do not adequately
cover these MJS edits; they are not a substitute for the offline suite and
explicit scoped scans. No files were staged or committed.

### Crossword Integration Plan

The [detailed browser Decision-mode design](../../../../codeDocs/TypeAgent/forAgent/projects/inProgress/2026-10-14_crossword-decision-mode/README.md)
proposes native Azure/Copilot support in AI Client, a Generative/Decision extension
option, and host-owned clue selectors chosen through bounded candidate IDs.
It recommends on-demand matching with validated cached bindings first, then
focused comparisons of batched clue filtering and number/direction indexing.
The first implementation is now available in the working tree: AI Client exposes
native `createDecisionModel`, the extension has an opt-in Crossword Mode setting,
and the isolated collector resolves issued candidate IDs on demand. Generative
remains the default. Standard rectangular Exolve entry has DOM-based focus,
crossing and rendered-cell readback checks; unsupported layouts fail explicitly.
The existing Generative entry loop remains a separately labeled legacy baseline.

The example clients now delegate transport and answer validation to the public
AI Client API. Their two-argument `decide(state, questions)` wrapper and existing
provider/region CLI flags remain available; production does not import examples.
Original provider-comparison evidence is unchanged.

Run a small native-contract smoke using only existing credentials:

```powershell
if (Test-Path $PROFILE) { . $PROFILE }
Set-Location '<repos-root>\TypeAgent\ts'
node .\examples\decision\smoke.mjs --live
```

It sends three questions about synthetic text to Copilot and the configured
Azure East US/Sweden Central decision pools. It acquires no new credentials and
prints model identity, outcome and whole-call timing, not endpoint headers.
This is API availability evidence, not an extension end-to-end or latency benchmark.
Joined local Chromium/native-provider scenarios found unstable crossword fit
acceptance: East US passed once, then all three lanes rejected valid fixture
requests below the unchanged 0.8 pilot gate. The implementation fails safely,
but reliable live crossword acceptance remains a rollout blocker. See the
design's validation log before treating Decision mode as production-ready.

For offline regressions on Node 24, use `--test-isolation=none
--test-concurrency=1` when combining the example tests: the existing MCP test's
stdout interception otherwise conflicts with the test runner's child-process IPC.

### Historical Collection

The local 2026-10-13 live collection (`results/2026-10-13/`) ran all 12
supported lanes: 147 planned cases, 298 decision-call attempts and 3 chat-call
attempts. Raw outputs, a source-hashed manifest, per-variant metrics and mismatch
IDs are retained together. All shopping instances and both crossword actions
passed their local readback checks; MCP flat/two-stage matched 32/32 fixture
labels. Dispatcher ambiguity, verification/workflow evidence handling and
commerce binding still need work. These are single-pass development results,
not calibration or speedup benchmarks. Older observations below are historical.

Run evidence JSON, result collections, complexity reports and media are generated
artifacts, not source-controlled fixtures. Existing local copies are retained;
fresh checkouts can recreate outputs with the documented runner commands.

Git LFS was already configured globally but its executable was missing. The
official portable 3.8.0 binary was SHA256-verified, installed per-user and added
to the user PATH; repository hooks were initialized. Profile-loaded circular
analysis now passes, including baseline worktree creation. Existing VS Code
processes may need a restart to inherit the updated user PATH.

## Browser Demo Recordings

Shopping, generative shopping, hybrid shopping and crossword accept
`--record-dir <fresh-directory>`. Recording is opt-in, uses an isolated
non-persistent context, captures a silent 1100 x 800 viewport, and preserves
finalized `scenario.webm`, raw video, case screenshots and `evidence.json`.
Normal runs retain their existing unrecorded context behavior. `--demo` adds
explicitly labeled pacing/captions; its timings are not benchmark measurements.

The small [recording batch](record-demos.mjs) calls those existing runners for
eight scenarios: each shopping variant's filter/details and crossword read/fill.
Detail/fill clips include their prerequisite step. It defaults to offline mocks;
`--live` performs real model calls. A dry-run validates options and lists scope
without creating output or launching browsers.

```powershell
if (Test-Path $PROFILE) { . $PROFILE }
pnpm -C ts --filter decision-model-example exec playwright install --dry-run ffmpeg
# After approving missing pinned recording assets:
pnpm -C ts --filter decision-model-example exec playwright install ffmpeg
$output = Join-Path $env:USERPROFILE 'OneDrive - Microsoft/Videos/web-videos/decision-browser-new-run'
node ts/examples/decision/record-demos.mjs --output-dir $output --dry-run --live
# After approving recording and live calls, optionally supply --cli-path:
node ts/examples/decision/record-demos.mjs --output-dir $output --live --chat-model gpt-5-mini
```

Run these commands from the repository root. Do not reuse an existing output
directory. The batch writes a source-hashed manifest and fails if any scenario
does not pass; it does not silently retry or lower fit thresholds. Capture
success is not media acceptance: independently decode, inspect and test seeking.
Keep recordings outside Git. For inline review, copy selected generated media
into a fresh `.scratch/` directory, which is already ignored and workspace-trusted.

The local recording collection (`results/2026-10-13/browser-recordings.md`) retains eight
completion demos plus one abstention take. All nine videos fully decode and
play/seek in installed Edge. The current integrated browser rejects their WebM
demuxing even from trusted copies; decoded frame sheets remain accessible there.
No MP4/H.264 encoder, extension or native recorder was installed.

The realistic successor is [Crossword 2](crossword-2/README.md): a locally
served 15x15 Exolve puzzle with 36 real clues, native keyboard entry, host-issued
clue references, crossing guards, and rendered-cell readback. Its four
[live recording scenarios](crossword-2/recordings.md) passed
with seven decision calls. The original 3x3 example and evidence are preserved.

## Run

From `ts/` after the normal workspace setup:

```powershell
pnpm --filter decision-model-example build
pnpm --filter decision-model-example test:local
pnpm --filter decision-model-example start --dry-run
pnpm --filter decision-model-example start
pnpm --filter decision-model-example start --sample support --repeat 5
pnpm --filter decision-model-example start --sample combined
pnpm --filter decision-model-example start --provider azure --model decision-1 --region eastus
```

`--provider` defaults to `copilot`, with `--model gpt-6-luna-decisions`.
Use an installed, authenticated Copilot CLI. The example honors the Copilot
configuration in the normal workspace config; `--cli-path` overrides its
executable. If the configured launcher cannot start, select a native executable:

```powershell
$copilotPath = Get-Command copilot -CommandType Application | Select-Object -Last 1 -ExpandProperty Source
pnpm --filter decision-model-example start --cli-path $copilotPath
```

For `--provider azure`, `--config-key` defaults to `decision_1`, the key in
`config.local.yaml`. `--model` is the **actual Azure deployment name**, or may be
supplied through `AZURE_DECISION_DEPLOYMENT`; no underlying model ID is guessed.
Both East US and Sweden Central now use `decision-1`. Sweden was renamed after
the comparison collection; its historical evidence retains the original casing.
The systemone URL does not include the deployment name, so it cannot be inferred
from the configured endpoint. `--region` applies only to Azure and pins a
configured region; otherwise AI Client uses the regional pool and rotates on
transient errors. It does not rotate on authentication failures. No credentials
or endpoint hosts are hard-coded.

Samples: `support` (three labeled tickets), `noul` (refund commitment), `score`
(incident severity), `combined` (three questions over JSON state), and `typeagent`
(illustrative agent routing with an unknown option). The default `all` runs seven
requests. Output includes normalized answers, probabilities, token usage when
present, per-request latency, median latency, and support classification accuracy.
Copilot's original answer array is retained as `nativeAnswers`, along with its
confidence fields and reported model ID.
`--repeat` accepts 1 to 100. `--dry-run` makes no inference or token requests.

The adapter validates answer types, numerical ranges, allowed choices, and
complete normalized probability distributions. A score uses zero-based indexes:
four levels mean a range of 0 to 3, including fractional weighted means. These
samples establish connectivity and request compatibility, not production quality
or calibration. Latency includes authentication, network, and any retries; there
is no warm-up exclusion or model-only timing claim.

## Config and AI Client Review

### Copilot

AI Client's `createCopilotModelEndpointProvider` starts or connects to a Copilot
SDK runtime, uses the configured chat model to establish a session, and requests
endpoint credentials bound specifically to `gpt-6-luna-decisions`. Decision
inference uses `POST /v1/decisions`, not a chat endpoint. The example refreshes
credentials once on HTTP 401/403 and stops the SDK runtime when the CLI exits.

The request follows OpenAI's Decisions guide: `input`, named `questions` arrays,
`predicate`, `choices`, and `levels`. Existing Noul samples map to predicates;
JSON state is serialized as text evidence. Response arrays are normalized for
the shared sample runner. Missing/duplicate names, invalid distributions, and
refusals fail explicitly rather than being treated as successful classifications.

The SDK's `listModels()` is not the complete Copilot catalog. The underlying
authenticated `/models` catalog advertises this model with type `decisions` and
supported endpoint `/v1/decisions`. It is experimental and hidden from the model
picker. No chat fallback is substituted for the decisions model ID.

### Azure

`loadRuntimeConfigSync` loads layered config and builds the typed deployment map.
AI Client's `discoverEndpointPoolFromConfig` resolves regional endpoints and uses
`azureApiSettingsFromConfig` to attach inherited or endpoint-specific credentials,
including a Cognitive Services token provider for identity auth. The existing
transport supplies timeouts, throttling, and transient retries.

The [Foundry Decision-1 guide](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/use-foundry-models-microsoft-decision)
defines a different wire contract from Copilot:

| Field                      | Azure Decision-1                      | Copilot Luna decisions           |
| -------------------------- | ------------------------------------- | -------------------------------- |
| Endpoint path              | `/providers/microsoft/v1/systemone`   | `/v1/decisions`                  |
| Model selection            | Actual Azure deployment name          | Copilot model ID                 |
| Input                      | `state`, text or JSON                 | `input`, text                    |
| Questions                  | Object keyed by question name         | Array with `name` fields         |
| Binary question            | `noul`, optional true/false criteria  | `predicate`                      |
| Choice options             | `criteria` object                     | `choices` array                  |
| Score levels               | `criteria` array                      | `levels` array                   |
| Answers                    | Object keyed by question name         | Array with `name` fields         |
| Binary result              | `noul` probability                    | `probability`                    |
| Choice/score probabilities | Object keyed by choice or level index | Array of value/probability pairs |

The local `decision_1` config resolves East US and Sweden Central endpoints, each
declaring capacity 30 and inheriting **identity** auth. Their full
`/providers/microsoft/v1/systemone` URLs match the Foundry documentation. Capacity
is declared metadata, not an enforced request-per-minute limiter.

`createChatModel` is not a Decision-1 client: its wire adapters construct chat,
Responses, or Messages requests and expect generated content. Decision-1 instead
accepts `{ model, state, questions }` and returns `answers`. This example reuses
the lower-level AI Client transport and leaves shared chat APIs unchanged.

### Opt-In Azure Test Variant

From `ts/`, using the installed credentials and local config:

```powershell
$env:AZURE_DECISION_DEPLOYMENT = 'decision-1'
pnpm --filter decision-model-example test:azure
# To test only one configured region:
$env:AZURE_DECISION_REGION = 'eastus'
pnpm --filter decision-model-example test:azure
Remove-Item Env:AZURE_DECISION_REGION
```

`AZURE_DECISION_DEPLOYMENT` is required and is not a secret. Read-only Azure
deployment metadata confirmed the East US deployment name `decision-1`; the
response reports underlying model `microsoft-decision-1`. Using that model ID
as the deployment name returned HTTP 404 after successful authentication.
`AZURE_DECISION_CONFIG_KEY` optionally overrides `decision_1`. Without a region
override, the suite tests each configured region serially, pinning its client
so a healthy endpoint cannot mask a broken deployment in another region.

The separate [live suite](decision.azure.test.mjs) checks choice, Noul and score
over structured state, a text-input classification, both guarded shopping
actions, and Crossword 2 clue reading, supplied-answer fills, and crossing
conflict rejection. It permits at most eight `decide` calls per region. The
conflict attempt selects a clue before the host rejects it without typing.
AI Client transport retries can add HTTP attempts for transient failures;
authentication and schema failures do not trigger another provider.

The suite uses synthetic input and localhost fixtures only. It makes no
generative calls, records no video, changes no permissions, and does not print
credentials. Exolve's pinned local renderer cache must be prepared with
`node examples/decision/crossword-2/fixture.mjs --setup` before the browser tests.
`test:local` remains offline and excludes this live test file. These smoke
checks do not establish calibration, broad accuracy, or comparative speedup.

### Copilot Live Check: 2026-10-12

All seven samples completed successfully through the native Copilot CLI and
`gpt-6-luna-decisions`; responses reported model `gpt-6-luna`. The three labeled
support tickets matched their expected teams, and the routing sample selected
`player`. Predicate, choice, score, and combined JSON-state requests all passed
response validation.

The single smoke run reported a 246 ms median, with the first request taking
2838 ms including SDK/runtime setup. This is not a quality, calibration, or
model-only latency benchmark. The configured extension launcher failed to start;
the successful run used `--cli-path` with the installed native executable.

### Azure Live Check: 2026-10-12

Historically, both regional URLs were called with the configured Azure identity. Both returned
HTTP 401 `PermissionDenied`: the current principal lacks
`Microsoft.CognitiveServices/accounts/AIServices/providers/action` for the
provider endpoint. This establishes endpoint reachability, **not successful model
inference or a verified deployment name**. No accuracy or latency benchmark is
available yet. Offline adapter tests and config resolution pass.

Have the resource administrator grant an appropriate inference role containing
that data action (the Foundry documentation recommends Cognitive Services User
for inference), or configure an authorized API key locally on the decision
endpoints. Do not put keys in this example, committed config, or command output.
Then rerun both regional samples and confirm the deployment name.

On 2026-10-14, after the permission fix, East US and Sweden Central each passed
the new native-schema, shopping and Crossword 2 smoke variant using deployment
`decision-1` and identity authentication. Each successful regional run made
eight decision calls and reported `microsoft-decision-1`; no question or fit
threshold was retuned. The affected build and all 107 offline tests passed.

## Research and Next Experiments

Microsoft-Decision-1 and TypeSafe's Jev expose the same broad System One pattern:
text or JSON state plus bounded questions, returning numerical judgments rather
than prose. Both document `noul`, `choice`, and `score`. Similar primitives do not
prove complete API interchangeability. Jev documents additional confidence and
legend fields; this prototype preserves any native fields without requiring them.
Top-choice probability and distribution-based confidence are not interchangeable.

Microsoft's launch report describes substantial speed and quality improvements
on its evaluation workloads. Independent JevBench results use different tasks,
hosting, and scoring methods and do not establish a universal winner. Evaluate
TypeAgent's own labeled requests and end-to-end timings rather than extrapolating
either benchmark's claims.

After live inference works, prioritize these shadow-mode experiments:

1. **Agent/schema selection:** Choice over enabled schema descriptions, including
   unknown and multi-agent cases. Compare with existing dispatcher selection;
   keep the existing translator for action parameters and composition.
2. **Candidate action disambiguation:** Choice over grammar/embedding candidates.
   Measure collision accuracy, abstention coverage, and selection latency.
3. **Search reranking:** Score or Noul over query/candidate pairs after retrieval.
   Compare ranking quality with knowPro's current retrieval results.
4. **Action verification:** Separate Noul questions for whether a proposed typed
   action matches the request and whether it needs confirmation. Keep deterministic
   schema validation, authorization, and required user confirmations authoritative.
5. **Workflow evaluation:** Score result quality or Choice among continue, retry,
   and handoff. Do not ask a decision model to generate a plan or explanation.

Build a held-out corpus with ambiguous and unsupported requests. Measure accuracy,
false positives/negatives, calibration, coverage at chosen thresholds, p50/p95
latency, and failures separately by region. Test paraphrases and reordered options.
Set fallback thresholds from that corpus, not from these seven smoke samples.
No production integration is proposed until this evaluation is complete.

## Experiment Pilots: 2026-10-13

Three parallel implementation workstreams produced seven independently runnable
pilots. Each defaults to offline execution, owns its fixtures and output, and
reuses the existing decision client. They remain independently runnable; the new
bounded comparison collector only invokes them. There is no production integration.
Offline heuristics and injected test clients are explicitly labeled;
they are not decision-model benchmark results.

| Priority | Pilot                                                   | Initial live outcome                                                                                                       |
| -------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1        | [MCP eligible routing](mcp/README.md)                   | One labeled request, three variants: all abstained and missed the expected tool.                                           |
| 2        | [Dispatcher schema routing](dispatcher/README.md)       | One labeled request, three variants: no-fit/clarify, all missed the expected schema.                                       |
| 3        | [Browser-state verification](verification/README.md)    | One connectivity case completed with matched judgments. Generative baseline not run.                                       |
| 4        | [Playwright shopping selection](web-shopping/README.md) | PRE-REMOVAL evidence: two attempts safely abstained; no live action dispatched. Current execution is host-only Playwright. |
| 5        | [Retrieval reranking](retrieval/README.md)              | One connectivity case completed. Embedding and generative baselines not run.                                               |
| 6        | [Workflow disposition](workflow/README.md)              | One connectivity case selected retry; advisory only, nothing executed.                                                     |
| 7        | [On-demand crossword](crossword/README.md)              | PRE-REMOVAL evidence: live clue read and supplied-answer fill succeeded with verified CAT readback.                        |

The crossword retains exactly `getClueValue` and `enterText`. Both select a
current clue element; reading its text and click/type execution are deterministic.
Stagehand and its multi-provider dependency fanout have been removed. Browser lanes
directly use the existing Playwright 1.57.0 dependency, isolated temporary persistent
contexts, and host-validated click/fill/Enter execution. Reports identify
`automation: "playwright"` and structural `explicitActModelCalls: 0`; there is no
generative executor or fabricated SDK instrumentation. Host enumeration uses owned
fixture annotations, not a general arbitrary-site adapter. Native/rerank commands
explicitly report unavailable, including dry-run. Copilot/TypeAgent chat and
responses support exists, but a native baseline needs a custom client implementation,
not new provider secrets. Browser live JSON is unchanged PRE-REMOVAL Stagehand
evidence. No live calls or external retailer sessions were run during migration.

Run all tests directly from the repository root, without triggering pnpm install:

```powershell
node --test --test-concurrency=1 ts/examples/decision/decision.spec.mjs 'ts/examples/decision/*/*.spec.mjs'
node ts/node_modules/prettier/bin/prettier.cjs --check ts/examples/decision
```

The migrated combined suite passed **66 tests**, with zero failures or skips,
using normal dependency resolution after a frozen offline install with scripts
disabled. The affected package build also passes. The browser slice contributes
9 contract and 14 integration tests. Offline browser reports and all four
desktop/mobile screenshots were regenerated; no live evidence was overwritten.
The lockfile adds only the example's reference to existing Playwright 1.57.0;
package records, snapshots and unrelated importers are unchanged from HEAD.
No new install-script approvals or secrets were used.

The historical pre-removal combined suite also passed 66 tests. That historical build
encountered a Stagehand transitive build-script approval gate; Stagehand is no
longer a dependency, and that blocker no longer affects the package build.
See each pilot's README for its own command,
fixtures, variants, and limitations. Small live samples establish connectivity
or expose failures, not quality, calibration, or speedup. Routing fit/question
design and shopping abstention need investigation before expanding the samples.

The prior consolidation's repository ratchets were not fully green: lint reported five pre-existing
`no-console` violations in the original sample runner; circular analysis cannot
create its baseline worktree because Git LFS is missing. Complexity and debt
ratchets pass for tracked changes, but exclude the new untracked pilot files.
The historical 66-test run and pinned formatting check included those files.
This migration leaves the current full repository gates to the parent.

## Separate Generative and Hybrid Comparisons

The generative baseline is feasible with existing AI Client APIs, with no new
provider SDK, key, or dependency. `generative/client.mjs` uses
`openai.createChatModel(...).complete(...)` through configured Copilot auth.
Following the reviewed NanoTests pattern, schema descriptions are visible in
the prompt as well as supplied as a structured-output constraint. Callers
validate exact fields and choice membership before host execution.

These comparison instances were initially added separately from the seven
approved pilots. Subsequent routing/shopping fit-question changes are documented
in the latest collection, without changing production behavior or gate thresholds.

| Instance                                                 | Design                                                                                                                                 | Live observation, 2026-10-13                                                                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [Generative shopping](web-shopping-generative/README.md) | Chat selects an issued ID or no-fit; same fixture, tasks, host guards, and readback as decision shopping.                              | Requested `gpt-5-mini`: 2/2 tasks verified, two generative calls, zero decision/executor model calls.                              |
| [Hybrid shopping](web-shopping-hybrid/README.md)         | Decision first at unchanged fit 0.8; semantic abstention permits fresh observation and chat fallback. Provider/validation errors stop. | Process exited without a report; attempted/completed model counts unknown. Offline tests verify fast-path and fallback separately. |
| [Decision commerce](webmcp-commerce/README.md)           | Schema-derived tool/enums/predicates plus exact original-input spans, local read-only catalog.                                         | One decision call chose expected search/filters/span; fit 0.13 below 0.5, so no execution.                                         |
| [Hybrid commerce](webmcp-commerce/README.md)             | Generative bounded read-only plan, then the same decision binder and deterministic executor.                                           | One chat call produced two valid intents; first decision call fit 0.39 below 0.5 stopped the plan. No execution.                   |

Shopping lanes share the same two tasks. Commerce live lanes currently use
different development requests (single intent versus search-plus-details), so
their smoke results are not a paired quality or latency comparison. None of
these observations establishes speedup or calibration. Thresholds were not
retuned to pass smoke cases. The initial shopping hybrid process failure was not
diagnosed; subsequent invocations checkpoint attempted counts. The latest
collection completed both hybrid tasks through the decision fast path, but did
not exercise live generative fallback.

The System One explainer illustrates Jev-style routing with simulated
probabilities/timing. Basketful's actual hosted bundle registers WebMCP tools
through `document.modelContext`, with schemas and consequence annotations, and
its own voice assistant uses Gemini. The local commerce pilot adopts the
bounded binding pattern, not the hosted implementation, catalog, or secrets.
Only its owned local registry executes, and only read-only tools are eligible.
Native WebMCP invocation, hosted-site integration, native Stagehand observation,
other generative baselines, and real retailer sessions remain deferred.

From the repository root:

```powershell
node ts/examples/decision/web-shopping-generative/run.mjs
node ts/examples/decision/web-shopping-hybrid/run.mjs
node ts/examples/decision/webmcp-commerce/main.mjs
node ts/examples/decision/webmcp-commerce/hybrid.mjs
npm --prefix ts/examples/decision run test:local
```

Shopping defaults to explicit fixture mocks with browser readback; commerce
defaults to zero-model dry execution, not a fabricated plan. Each README has
capped live commands and evidence caveats. The existing provider dependency
graph and lockfile are unchanged by these additions.

Validation: **99 tests pass**, zero skips/failures; affected package build,
all-module syntax, and pinned formatting pass. New comparison folders have no
lint violations and meet cyclomatic 25/cognitive 30 limits. Desktop/mobile
commerce checks verified image loading, no horizontal overflow, and read-only
search. Full repository gates remain blocked by five original runner console
violations, three over-complex functions in the earlier MCP/dispatcher/workflow
pilots, and missing Git LFS for circular analysis. The debt gate passes.
Git ratchets exclude untracked additions, so focused checks covered those files.

## Sources

- [OpenAI Decisions API guide](https://developers.openai.com/api/docs/guides/decisions)
- [Foundry deployment and API guide](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/use-foundry-models-microsoft-decision)
- [Microsoft launch and evaluation report](https://commandline.microsoft.com/microsoft-decision-1-model-foundry/)
- [TypeSafe Jev introduction](https://docs.typesafe.ai/)
- [Jev Choice](https://docs.typesafe.ai/primitives/choice), [Score](https://docs.typesafe.ai/primitives/score), [Noul](https://docs.typesafe.ai/primitives/noul)
- [Independent JevBench methodology and results](https://benchmarkheaven.com/jev-models)
- [System One explainer](https://system-one-explainer.netlify.app/)
- [Basketful WebMCP demo](https://shopping-webmcp-demo.netlify.app/)
