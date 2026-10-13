# Decisions Prototype

Runs `gpt-6-luna-decisions` through TypeAgent AI Client's Copilot provider by
default. Microsoft-Decision-1 on Azure remains an optional comparison backend.
This is an isolated experiment, not a change to dispatcher behavior.

## Run

From `ts/` after the normal workspace setup:

```powershell
pnpm --filter decision-model-example build
pnpm --filter decision-model-example test:local
pnpm --filter decision-model-example start --dry-run
pnpm --filter decision-model-example start
pnpm --filter decision-model-example start --sample support --repeat 5
pnpm --filter decision-model-example start --sample combined
pnpm --filter decision-model-example start --provider azure --model microsoft-decision-1 --region eastus
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
`config.local.yaml`. `--model` is the **actual Azure deployment name**, defaulting
to `microsoft-decision-1`; change it if you named your deployment differently.
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

The local `decision_1` config resolves East US and Sweden Central endpoints, each
declaring capacity 30 and inheriting **identity** auth. Their full
`/providers/microsoft/v1/systemone` URLs match the Foundry documentation. Capacity
is declared metadata, not an enforced request-per-minute limiter.

`createChatModel` is not a Decision-1 client: its wire adapters construct chat,
Responses, or Messages requests and expect generated content. Decision-1 instead
accepts `{ model, state, questions }` and returns `answers`. This example reuses
the lower-level AI Client transport and leaves shared chat APIs unchanged.

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

Both regional URLs were called with the configured Azure identity. Both returned
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
reuses the existing decision client. There is no central runner or production
integration. Offline heuristics and injected test clients are explicitly labeled;
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

## Sources

- [OpenAI Decisions API guide](https://developers.openai.com/api/docs/guides/decisions)
- [Foundry deployment and API guide](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/use-foundry-models-microsoft-decision)
- [Microsoft launch and evaluation report](https://commandline.microsoft.com/microsoft-decision-1-model-foundry/)
- [TypeSafe Jev introduction](https://docs.typesafe.ai/)
- [Jev Choice](https://docs.typesafe.ai/primitives/choice), [Score](https://docs.typesafe.ai/primitives/score), [Noul](https://docs.typesafe.ai/primitives/noul)
- [Independent JevBench methodology and results](https://benchmarkheaven.com/jev-models)
