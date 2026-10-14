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

Local WorkIQ diagnostics and private evidence belong in the ignored
`ts/.workiq-experimental-validation/`, `ts/.workiq-offline-validation/`, or
package-local `.native-*` run directories. Keep reusable harness scripts and
self-contained regression tests in source control; tests must not depend on
private session files or artifacts from a previous live run.
Offline grading accepts host-native physical fixture paths as well as Windows
path identities. Live native evaluation remains Windows-only; Unix test runs
use a private executable fixture and do not launch the authenticated Copilot CLI.

## Native macro evaluation - gated controller and offline tooling

**Current restriction mechanism (CLI 1.0.95):** required supported
`extensionMode: "load_only"` seeds only the fresh owned home, then confirms the
public `/extensions mode` dialog before any task. Actual owned settings and
native caption must agree. Five exact unfiltered SDK inventories contain only
`task` and the two synthetic document tools, with exact schemas. The registered
Node getter and six actors across four mode transitions must also agree.
A fresh bounded metadata diagnostic passed these prerequisites with **no
selector warnings**. Availability is not an execution-permission grant.

Unsupported redundant management exclusions were removed, not ignored.
All unresolved selector warnings still fail closed. The earlier warning-bearing
capture remains blocked historical evidence; its temporary
`captureRestrictionMetadata` option is removed and is not an admission path.

The owned normal-hook bridge uses public Windows named-pipe peer identity,
physical wrapper/router process and source bindings, actual stdin and native
events. Its trusted reader returns an opaque branded object; serialized JSON
cannot authenticate provenance. Actual PowerShell invocation is exercised
offline through the staged wrapper, real router child and OS receiver.
The initial synthetic attempt failed because its quoted Node executable lacked
PowerShell's call operator; that evidence remains rejected. No positive normal
route or macro lifecycle acceptance is inferred from its successful document
tools.

The subsequent call-operator and bare-selector attempts stopped before targets
on retained document-selector warnings. Those rejected attempts are unchanged.
Installed SDK 1.0.13 documents bare exact names as supported availability filters;
the controller now uses the two exact model-facing document names and
`builtin:task`, with independent exact MCP source/schema checks.

**Current effective-policy readiness:** five connected servers is not tool
readiness. Before any task, the owned native extension invokes the public
`session.tools.initializeAndValidate`, then preserves the initial unfiltered
`getCurrentMetadata` snapshot and all four post-transition snapshots. Exact
namespaced/server/tool identities, schemas, session and all owned actor/getter
bindings must pass. A fresh actual read-only diagnostic proved this sequence:
known document warnings were first observed before successful initialization,
and the five current inventories were exact afterward. Raw warning-bearing
diagnostic status/text remains retained, not rewritten as a passed task.
The SDK notes that initialization may be a no-op for unsupported session classes;
an empty response alone is never readiness proof.

Only configured document-selector warnings can remain pending during this
bounded read-only phase. No models or tools may execute while pending. Their
previously observed text may remain in the viewport after independently proved
current policy; unrelated/excluded/new selectors and warnings appearing after a
reload marker still fail. Missing initialization/current inventories or any
source/schema/control disagreement blocks tasks. No wildcard, metadata filtering
or execution-permission grant is introduced.

The first policy-proved baseline physically reached the OS-authenticated
wrapper/router, then correctly failed because native CLI replaced its
`CLAUDE_PLUGIN_DATA` with an owned home-specific plugin directory. The staged
owner-bound hashed policy now restores only the explicitly selected child
configuration root; native working directory, actual stdin, other environment,
authentication and execution permissions remain unchanged. Normal hook process
cwd is the exact owned plugin directory; request cwd remains the exact synthetic
workspace. Earlier failed effects are never regraded as acceptance.

The macro validation campaign is separate from the historical seven-candidate
evaluation below. Its prospective `macro-native-eval-v1` protocol uses the actual
interactive CLI, synthetic fixtures and independent event/backend/content
oracles. The packaged native controller is implemented for a bounded synthetic
Direct learning/reuse/restart rehearsal. **Packaged learning/publication/Direct
reuse correctness has passed; genuine restart acceptance remains pending.**
Offline adapter tests are not native acceptance or a measured campaign.

**Fresh ordinary baseline:** the packaged CLI 1.0.95 rehearsal with requested
root `gpt-5.6-sol` / Direct runner `gpt-6-luna` passed the original branded
normal-hook attribution and independent synthetic document oracle. It used
fresh owned roots, exact availability/source/schema proofs and the restored
owned child configuration. Its successful bypass `hook.end` genuinely omitted
`output`; the grader admits that shape only with current authenticated callback,
control and independent native/root/tool/audit evidence. The verdict was
`passed-attribution-only`, `grammarHit: false`, not macro lifecycle acceptance.
It observed three assistant turn starts and one model-start/call pair; service
usage and the role of the recorded auxiliary model remain unknown.
All 15 independently frozen owned identities, listener and window were absent
after cleanup. Earlier failed attempts remain failed.

**Current task gate:** `attributionOnly: true` admits one bounded ordinary
synthetic baseline only after current prerequisites and the branded
`native-normal-hook-callback-v1` grader interface are available. It requires
`restart: false`; capture, publication, reuse, restart and WorkIQ are not admitted
by this mode. Normal execution permissions remain unchanged. Null callbacks,
JSON copies, missing current root terminal/interaction identity and unsuccessful
hooks remain non-admitting. A proved ordinary `bypass` is not a grammar miss.
MCP selected-source/finalized capture and restart receipt integration remain
separate gates; offline tests are not native acceptance.

The full live task path additionally requires the independent
`native-finalized-selected-source-v1` grader capability. Its acquisition phase
uses ordinary MCP mixed source capture, not caller-mode macro execution: native
Prepare and Record commands are verified through actual owned RPC effects.
The controller must observe both the actual armed lease and the claimed lease
before product finalization; a jump directly to completed blocks rather than
reconstructing a token. Actual subscribed SDK completion finalizes the source;
no persisted `session.idle` is invented.

The synchronous `readFinalizedSource({sessionId, tokenId})` capability closes
over the admitted owned service, instance store and observed lease. It checks
the current physical service identity and a stable, regular, bounded trace
file, returning actual completed state, trace bytes/digest and store location.
Neither callers nor public receipts can select an arbitrary root. JSON loses
the function and callback brand. A separate read-only v1 synthetic source audit
is explicitly non-admitting; private-artifact v2 is blocked there rather than
silently treated as inline v1. The grader must independently join the finalized
source with current native events, full fixture contents and backend audit.
Until that capability is available, full launches block before any models.
Capture alone does not authorize publication or prove grammar reuse/restart.

Actual finalized training exposed a native persistence projection: its tool
completion results omitted SDK `detailedContent` and `contents`, while the
actual finalized SDK trace retained them. That attempt remains blocked; the
controller never fills missing originals from the trace or weakens equality.
The owned native extension now uses the public `session.on` subscription to
journal only full original root events for the two exact synthetic document
tools. Model messages, other servers and child tools are not copied. The
opt-in writer has per-record/total bounds and writes only in the fresh owned
data root.

Current terminal evidence replaces a whole completion/start event only with
its independently observed SDK original after exact event identity, timestamp,
parent, actor, owner, session and native-projection correlation. Only the two
source-documented rich result omissions (and a false transient flag) can differ
in that projection; all other contradictions block. The original event itself
is retained unchanged, not fabricated or assembled from stored trace values.
The independent grader still compares full raw originals to the finalized
source and backend audit. This synthetic observer is not WorkIQ/full-wave
admission or an authorization to collect tenant originals.

The observer's JavaScript observation clock and the SDK event timestamp are
independent: an actual handler observation preceded its unchanged SDK timestamp
by 1 ms. Observation times must lie inside the actual observer-installation
window; emitted timestamps retain their separate exact native-event and trial
window checks. Neither timestamp is rewritten, offset or given invented slack.

**Fresh selected-source rehearsal:** CLI 1.0.95 passed both the ordinary baseline
and the original branded MCP selected-source oracle, including actual
armed/claimed/completed state, full SDK originals, the physical finalized v1
trace and backend audit. Both tasks were correct with no grammar hit. The
subsequent Prepare job genuinely failed extraction with an unresolved
output uncertainty about showing fetched contents; the actual stored response
contains the full synthetic document. The controller stops on that real failed
job and retains `learningFailure` rather than retrying, approving a partial
draft or changing the prompt. No publication, Direct reuse or restart passed.
This is a correctness rehearsal, not a scored freeze or speedup measurement.
It used 6 assistant starts and 2 recorded model-start/call pairs in 89.272 s;
service preparation usage remains unknown. Independent cleanup verified all
15 frozen owned identities, the listener and the window absent.

A separate fresh run with the validated body-free extraction projection again
passed all 33 ordinary and 40 selected-source checks. Its actual persisted
recipe had no uncertainties: extraction passed. Preparation then failed during
the build attempt with `Expected a learning JSON object with supported fields.`
The failed job, its recipe and exact error are retained; an unavailable raw
build response is not reconstructed or treated as a supported draft. This run
also stopped before publication/reuse/restart, at 109.483 s with 6 assistant
starts and 2 recorded model-start/call pairs. Independent cleanup verified
16 frozen owned identities and no surviving process, listener or window.

`retainSyntheticLearningResponses: true` is a separate, explicit diagnostic
opt-in, limited to a full synthetic rehearsal with at most 20 target turns,
300000 ms and no restart. The owned service receives only the fixed private
build-response policy path; inherited diagnostic/approval flags are removed.
After the actual armed source lease verifies its session and workspace, the
controller writes a new immutable policy before submitting training. It binds
the exact selected session, prompt, lookup title and dependent synthetic fetch
ID. Missing session/source/policy evidence must fail rather than broaden scope.
The product observer independently verifies the physical owned instance and
persisted source, then retains at most two original build responses of at most
256 KiB each in the private owned data root. It is not generic model logging,
an execution grant, model-facing evidence or a grading/publication receipt.
Normal runs without this opt-in do not enable response retention.

**Fresh full learning/reuse correctness passed:** the bounded diagnostic run
passed 33 ordinary baseline checks, 40 selected-source checks and 11 changed-
document Direct reuse checks. Actual Prepare extraction/build/grammar succeeded,
the complete two-tool draft was inspected, and the bounded external operator
approved immutable version 2. Fetch used a recorded `stepResult` dependency on
the current lookup identifier; reuse returned the complete different document
with actual grammar attribution and native handled-hook completion. Normal
execution consent/backend authorization was unchanged. The private initial
build response was valid (3125 UTF-8 bytes); the historical malformed build
field remains irrecoverable, not retrospectively diagnosed or accepted.
The run finished in 157.174 s with 9 assistant starts and 3 recorded model
start/call pairs. Independent cleanup found 17 owned identities and no remaining
process/listener/window. This is unrecorded synthetic correctness, not a scored
freeze, WorkIQ admission or matched speedup measurement.

A separate fresh restart-enabled workflow passed ordinary and selected-source
checks but stopped before publication/restart on a new extraction uncertainty
about unique title matching and the intended fetched document. Its actual
`extract: 1` failed job is retained; no uncertainty was filtered or prompt
rescued. At 94.047 s/6 assistant starts, all 13 owned identities and its window/
listener were independently absent. That attempt does not negate the preceding
accepted learning/reuse sequence or establish restart acceptance.

After the tested body-free dependency projection repair, another fresh
restart-enabled workflow stopped at the ordinary baseline: the model inserted
a blank line and Markdown hard-break spaces inside the fetched document.
Every expected word/line was present, but the approved oracle deliberately
requires contiguous verbatim document contents and correctly failed
`full-exact-document-content`. No Record, learning or restart occurred.
The 80.244 s/3-assistant-start attempt and all 15/0 cleanup evidence are retained.
The controller does not normalize this failure, change the frozen prompt,
retry the old session or loosen the exact oracle. A different rendering contract
would require explicit separate approval and versioning.

**Future synthetic rendered-content contract:** newly generated runs may explicitly
set `renderingContract` to
`{"protocolVersion":"synthetic-document-rendering-v2","fixtureShape":"synthetic-prose-lines-v1"}`.
Their manifest and result declare `macro-native-rehearsal-v2` and the complete
contract, which is passed to every trial grade. Absence preserves the historical
contiguous-verbatim v1 oracle; existing results are never regraded.

This output-only contract permits a 1–6 `#` heading prefix followed by one ASCII
space on the title, strictly empty separator lines, and at least two trailing
ASCII Markdown hard-break spaces on originally unpadded prose lines. All other
characters, case, punctuation, interior spacing and line order must remain exact
in a complete line-bounded region. It does not perform general Markdown, newline,
word or whitespace normalization. Fixtures must have a `synthetic-doc-*` identity,
the title as their first line, and at least two nonempty unpadded ASCII prose
lines matching the grader's explicit whitelist. Raw/code/indented/Markdown/table
or non-synthetic fixture shapes block, even with a verbatim answer; there is no
fallback. Source originals, SDK results, permissions, lease, callback brand,
backend effects and WorkIQ admission remain unchanged.

The first fresh v2 restart-enabled rehearsal correctly failed its ordinary
baseline: the native answer wrapped the unchanged document in a `text` code
fence, which is outside this contract. All other 32 ordinary checks passed,
including current branded callback, exact lookup/dependent fetch and backend
effects; `taskCorrect` was false and `grammarHit` false. No capture, learning,
publication, reuse or restart occurred. Its new v2 manifest/result remain failed,
without prompt rescue or normalization. The run used 3 assistant starts and
3 recorded model-start/call pairs in 73.352 s; persisted model labels
`gpt-5.6-luna-utility` and `gpt-4o-mini` do not establish root/runner roles.
Independent cleanup verified 13 owned identities and no surviving process,
receipt peer, listener or window. This is a concrete unsupported-output-format
blocker, not live acceptance, WorkIQ admission or a benchmark.

**Future exact plain-text fence contract:** explicit
`{"protocolVersion":"synthetic-document-rendering-v3","fixtureShape":"synthetic-prose-lines-v1"}`
selects `macro-native-rehearsal-v3` in new manifests/results. The pre-model gate
requires the separate tested `syntheticDocumentFenceRenderingContract` capability;
the frozen v2 export does not authorize v3. Every trial receives the declared
contract without inferring a version from its answer.

Without fence markers, v3 retains the narrow v2 prose rules. With markers, it
requires exactly one column-zero opening ` ```text ` or unlabeled ` ``` `
and one exact closing ` ``` `. The entire original document, including its
title, must occur unchanged inside that single fence. Outside prose/heading
cannot replace missing inside text. Extra, nested, malformed, indented, tilde
or executable-language fences reject; there is no generic normalization or
plain-region fallback around unsafe fences. Supported synthetic fixture shapes
and all original source/permission/effect guards remain unchanged.

Historical v1/v2 semantics and results remain frozen: default v1 already permits
an exact-body fence through its contiguous-substring oracle; v2 rejects that
wrapper, and v3 explicitly admits it. V1 still rejects internal blank-line/
hard-break decoration that interrupts its expected document string. The failed
v2 run above is never regraded under this new contract.

The native interaction classifier recognizes the exact standalone informational
notice “Approval of a saved macro does not grant tool permissions.” even when
the preceding status heading has scrolled out of the viewport. It supplies no
input for that notice; appended unknown questions and actual consent dialogs
still fail closed or require their existing exact scoped approval.

The fresh normal v3 recovery rehearsal passed baseline (33 checks), selected
training (40 checks), finalized capture and bounded review/version-2 publication.
Changed-document Direct reuse reached the actual grammar route and handled-hook
terminal, but correctly failed v3 rendering: the runner prefixed each document
line with a Markdown blockquote (`> `), which neither narrow prose nor the exact
single-fence contract admits. Restart was not attempted after failed reuse.
This is not restart acceptance, and no historical result was regraded or
rendering/permission contract widened.

Future blockquote-aware scoring is a separate explicit opt-in:
`{"protocolVersion":"synthetic-document-rendering-v4","fixtureShape":"synthetic-prose-lines-v1"}`
declares `macro-native-rehearsal-v4` in new manifests/results. Native preboot
requires the separately tested `syntheticDocumentBlockquoteRenderingContract`
capability; v2/v3 exports cannot admit v4. Every trial receives the configured
contract without inferring it from the answer.

V4 retains v3's narrow prose/exact single-fence alternatives, or accepts the
complete original document with exactly one literal `> ` prefix on every line.
All remaining text, bytes, whitespace and order must match the original; mixed,
nested, missing/extra or internally decorated quoted lines and quoted fences
are not normalized. No generic blockquote stripping or content normalization
is allowed. Historical v1/v2/v3 contracts and results remain frozen; the failed
v3 reuse above remains failed, not retroactively accepted under v4.

Future experimental answer similarity supersedes further formatting-wrapper
enumeration for new rehearsals. It is explicit v5, not a change to any prior
oracle:

```json
{
  "protocolVersion": "synthetic-document-similarity-v5",
  "fixtureShape": "synthetic-prose-lines-v1",
  "fixtureId": "macro-eval-synthetic-prose-fixture-v1",
  "algorithm": "ordered-levenshtein-codepoints-v1",
  "threshold": 0.9,
  "protectedDocuments": [
    {
      "key": "<every trusted corpus document key>",
      "title": "<exact title>",
      "expectedId": "<exact current fixture ID>",
      "contentSha256": "<SHA-256 of untouched source content>",
      "markers": ["<source line at zero-based index 1>", "<source last line>"]
    }
  ]
}
```

The declaration requires exact keys, the fixed numeric threshold/algorithm and
known fixture ID, and complete unique metadata for **all** trusted fixture
documents. Hashes, IDs, titles and both distinct literal marker roles are checked
against the source corpus before any target submission. The native manifest and
result declare `macro-native-rehearsal-v5`; preboot requires the new tested
`syntheticDocumentSimilarityContract` export, never a v2/v3/v4 capability.
The full effective contract is snapshotted before each trial, persisted with
that trial (including an incomplete trial), and passed unchanged to grading.
Normal native changed-document reuse selects a different document in the same
immutable corpus; stale metadata for mutated expected IDs/content rejects before
submission rather than silently adopting a changed digest.

V5 scores only the bounded title-through-last-marker answer region using
deterministic ordered Unicode-codepoint Levenshtein similarity
`1 - distance / max(expectedLength, actualLength) >= 0.9`. Exact title and both
unique fixture markers must occur in their expected order in that same scored
region, with the first marker immediately following the normalized title line
and the last marker ending the region; foreign fixture markers reject.
The answer score is approximate after
bounded display-only normalization, **not** full-content exact preservation.
That normalization converts CRLF to LF, trims/collapses ASCII spaces and tabs,
omits empty lines and code-fence delimiter lines, and makes at most four passes
peeling explicit heading/quote/list/numbered-list prefixes and whole-line
bold/inline-code wrappers. It does not change case, words, digits or punctuation,
or compare unordered sets. The best valid anchored region is selected within
fixed bounds: 65536 input length, 1024 document/region codepoints, 64 region
lines, eight candidates and two million dynamic-programming cells with two-row
memory. Exceeded bounds fail explicitly rather than falling back.
Numeric metric/threshold, distance/denominator and anchor/region diagnostics
remain in each trial's `grade.answerScoring`.
Source originals, SDK originals, document identities, dependencies, audit,
permissions, grammar attribution and native completion remain strict.
No WorkIQ oracle or historical v1/v2/v3/v4 result is regraded under v5.
Negative-intent cases declare the experimental criterion inapplicable; they are
never accepted by fuzzy document scoring.

The first fresh normal v5 rehearsal passed baseline (38 checks, similarity 1)
and selected training (45 checks, similarity 1), then finalized capture, bounded
review and version-2 publication. Direct reuse reached the grammar route and
handled-hook terminal with exactly one macro invocation and the expected
lookup/fetch audit, but omitted the entire document body. Its answer instead
summarized completed steps and claimed an unavailable `submit_macro_candidate`
was required. No valid protected-anchor region existed, so similarity/distance/
denominator remained null and all answer-anchor guards failed. The overall run
remains failed; restart was not attempted. This is real answer content loss,
not a formatting-wrapper or near-threshold failure. The retained evidence was
handed to the engine owner for source-grounded diagnosis, without prompt rescue,
regrading, permission changes or an unobservable same-model retry.

The engine owner's tested completion-policy repair was then consumed by a
separate fresh normal v5 run. Its baseline/source trials again passed at
similarity 1, with finalized native SDK/source capture, but Prepare failed on a
new strict grammar reproduction assertion for a generated Orion paraphrase.
Publication, repaired RUN behavior and restart were not reached in that run.
The failed job/trace remain preserved; no archived-job retry, manual draft,
prompt rescue or scoring relaxation was used. That fresh-learning attempt did
not reach live RUN acceptance; the separate catalog-only acceptance below does
not repair or retrospectively accept its Prepare failure.
Per-example grammar generation accepts any NFA hit, while macro preparation
requires every combined-rule match to reproduce the exact expected action and
inputs. That stronger guard may intentionally reject a generated rule; the
discarded transient grammar tuple prevents distinguishing no-match from
wrong/extra-match here. No compiler or guard defect was proved.

#### Approved-catalog RUN/restart continuation

To test an updated runner without repeating stochastic learning, the native
controller supports one narrowly scoped, explicitly admitted
`approvedCatalog` phase. It consumes the **actual persisted approved version**
in its existing evaluator-owned store, not a copied catalog, new draft, or
manual approval. This phase requires normal diagnostics-off v5 scoring,
`restart: true`, `retainSyntheticLearningResponses: false`, and bounds no
greater than 20 target turns / 300000ms.

The exact declaration is
`{artifactRoot, macroId, owner, restartCase, sourceHashes, version}`.
`sourceHashes` requires SHA-256 pins for `owner`, `manifest`, `result`, `corpus`,
`reviewedDraft`, `version`, `trace`, and `originals`. Admission verifies the
recorded successful training/review/publication, immutable approved definition,
finalized source identity, exact corpus, physical owned paths, prior cleanup,
and current supported catalog inspection/validation. `restartCase` must name
a distinct positive document in the same family, different from both learning
and reuse documents.

Output must be a **fresh direct child of the original owned root**. An exclusive
phase lock protects the same canonical workspace/store. Only known
runtime/config/control sidecars are temporarily retained and restored; new
homes, staged runtime snapshots, manifest, audit, sessions and results remain
separate phase artifacts. Learning is switched off through its supported RPC,
then its previous preference is restored. Existing jobs/suppression and all
pinned historical evidence must remain unchanged; unexpected learning state
is reported, never erased. Grammar/body-response diagnostics stay off.

The phase must independently pass current Direct reuse, stop its exact owned
console/service, genuinely restart that service/store, and pass a fresh
session's different-document reuse with the same approved version. Current
SDK originals, audit, binding, native terminal, grammar route, permissions and
experimental similarity/anchor guards are unchanged. Results distinguish old
learning provenance from current runtime evidence. A passing continuation
accepts **RUN/restart only**; new-learning/end-to-end reliability remains a
separate, unexercised acceptance stage.

A bounded current-runtime continuation subsequently **passed both stages**
using the original actually approved `95717c0e…` version 2 in that same owned
store. Direct Vega reuse scored 1.0 (distance 0 / denominator 113), and Lyra
reuse after actual service restart and a distinct native session scored 1.0
(0 / 104). Both exact titles and both fixture markers passed; both routes were
grammar/version 2, with one whole-macro invocation and no write effects per
trial. Current SDK originals, binding/audit and handled native completion
passed independently. No new learning, publication, diagnostic response
retention, tenant access, OBS or performance campaign occurred.

Earlier continuation attempts exposed controller-only restart defects: a
retired session's catalog admission and mixed-routing override survived restart,
violating the unchanged strict initial bypass/delegate getter contract. The
controller now archives and resets only those owned boot sidecars after exact
shutdown, before fresh initialization. A separate preferences-array comparison
bug was corrected to preserve the real row schema and exact owned workspace;
jobs/suppression equality remains strict. Earlier results remain unchanged.

The accepted phase used 6 bounded target turns (20 maximum); overall elapsed
161300ms remained below 300000ms. These are raw observations, not speed or
service-model-usage claims. All 48 persisted owned identities, exact windows
and its receiver were independently absent; scoped history and the original
learning preference were restored, with immutable version/source pins and
existing jobs/suppression unchanged. The native slot was released.

All trial timings end at the first observed native terminal, before callback
grading/source-file verification; both ordinary baseline and Direct reuse use
the same controller-submit boundary. Source finalization/preparation waits and
cleanup are separately outside that per-trial latency, while the overall
controller deadline still covers them.

Metadata diagnostics seed an owned bypass config and opt-in control admission.
They invoke the native SDK registry and existing local mode/status commands (not chat),
collect actual extension/MCP/compiled-hook mode and config-root receipts, verify
live actor ancestry against the owned console tree, and preserve disagreements.
The compiled-hook getter is not a native user-prompt hook invocation. Every
native model-start/call event is reported, including telemetry persisted during
cleanup; service model usage remains unknown without a complete service contract.
An empty canonical target-turn counter is never a zero-model claim.

**Historical startup diagnostics (superseded, not admission evidence):** an
earlier bounded metadata diagnostic stopped before hook-registration consent with
pending fixture tool-name warnings. Four actual MCP startup receipts and the
native-extension startup receipt agreed on the exact owned root/bypass/digest;
they did **not** prove a native user-prompt invocation or SDK status runtime.
There is no evidence justifying a `TYPEAGENT_PLUGIN_DATA` helper override.
The status child now uses the canonical installed `node` hook runtime, since
the actual native extension executable is `copilot.exe`, not Node.

Metadata-only startup may defer catalog warnings only during exactly verified
hook-registration consent, not subsequent general catalog loading. Unknown permissions,
failed MCP initialization, model telemetry, persistent warnings at complete
catalog, and any task admission remain strict failures. Per-request owned control mismatch fails before service translation.
Fresh no-warning all-actor transitions now pass; ordinary-route and finalized
capture acceptance still require their independent current physical evidence.

With `diagnosticOnly: true`, the owned admission enables fixed bypass/delegate,
MCP/mixed and Direct/mixed transitions using `commands.list/invoke` and
`tools.getCurrentMetadata`. Four actual MCP processes refresh their public
receipts on owned config writes; the registered status getter runs canonical
Node and snapshots each phase. No `send`, tool execution, recording lease or
model command is used. Request context is projected only from parsed hook input;
startup/status has `source.request: null`. Neither this child nor controller IPC
is a native callback. `native-control-diagnostic-result.json` retains partial
outcomes even when startup blocks; callback/capture remain null.
The coordinator now waits for the controller's exact-session, consent-aware
full-catalog admission before querying the SDK. Rejected safe tool-name metadata
is persisted before validation. These post-diagnostic corrections are offline
regressions, not another live run or proof of the observed mismatch's cause.

The subsequent bounded diagnostic accepted only checked owned workspace/hook
consent and reached five connected MCP servers without restriction warnings.
Actual `commands.list` returned the expected status/mode commands; SDK tool
metadata failed the exact filter before any setter/status invocation. No
rejected projection was retained in that attempt, so its mismatch cause is
unresolved. There were no transitions, native prompt callbacks, capture or task
events; service model usage remains unknown. The corrected catalog-admission
barrier/projection persistence is offline-tested only; another launch requires
parent scheduling.

A later single bounded attempt stopped before SDK queries: the readiness
predicate returned a boolean, so the admission writer omitted the observed
session ID. The receiver correctly rejected that missing exact-session binding.
`nativeReadyObservation` now returns the original complete frame, with unit and
lifecycle assertions for the serialized session ID. This correction is offline
only; no second boot, setter, getter or verification bridge ran.

The diagnostic now checks the initial exact owned root before any setter and
uses the registered status getter's public `spawnSync` child PID plus staged
script hash as read-only getter provenance, never native-hook authentication.
It exercises bypass → MCP mixed → Direct → restored bypass and snapshots safe
tool names/schema shape at each phase. Model-visible `task` is optional; the
authenticated host task API is separate and uninvoked. Pending workflow inventory
can accompany independently verified pure controls but never enables workflows
or satisfies the conditional bridge-implementation gate.
Known registration reload can leave historical MCP receipt files. Admission now
contains current owned OS identities; only those actors participate in mode
snapshots. Historical files remain intact, and duplicate current-role receipts
fail closed. This is metadata control-plane selection, not callback authentication.

The next authorized single CLI 1.0.95 metadata diagnostic proved exact-session
admission, the initial registered canonical Node getter and all four transitions,
including restored bypass with saved mixed routing. Current OS-admitted actors
agreed on the owned config/data root and public digest at every phase. The
persisted safe SDK catalog contained the exact synthetic document tools and
non-MCP `task`, but also `extensions_reload` and `extensions_manage`. These
unexpected tools keep the workflow inventory and conditional bridge prerequisite
**blocked**; their presence in metadata is not execution or permission proof.
No tool was invoked to probe them, no filter was relaxed, and no normal-hook
verification bridge or workflow ran. Rejection diagnostics now retain exact
unexpected names, with an offline regression for this observed catalog.
The attempt took 59.978 seconds excluding cleanup; native model/target counters
were zero, service usage unknown. Independent cleanup found no exact owned
survivors, listener or owned window. Further launch requires new authorization.

Offline investigation of that inventory preserved the actual projection. The
installed SDK 1.0.13 describes `getCurrentMetadata` as a **currently initialized
lightweight tool snapshot**, with `CurrentToolMetadata.name` labeled
**model-facing**. It supplies no enabled-state, execution-permission or
registration-only discriminator. Consequently the extra management names cannot
be exempted as harmless registered-but-disabled tools, and the controller's
fail-closed inventory check is not proven to use the wrong semantics.

The pinned CLI 1.0.95 help supports both `--available-tools` (model availability
allowlist) and `--excluded-tools` (model availability exclusion). SDK
`SessionConfigBase` documents exact bare names across any source and exclusions
taking precedence over availability. Execution permission controls remain
separate; neither metadata presence nor Manual Approval proves management-tool
denial. The installed CLI ships an opaque executable, not readable registration/
filter implementation, and the preserved startup log has no exact filter cause.
Whether these tools are injected after filtering, included only in a wider
snapshot, or executable despite restrictions remains unresolved.

No launch or predicate was changed on that evidence. The then-proposed
follow-up was a newly authorized metadata-only run retaining the
existing allowlist and adding exactly
`--excluded-tools extensions_reload extensions_manage`, then observing the
initial owned getter and actual safe SDK snapshot. These documented exact
exclusions are a conservative hypothesis, not a demonstrated CLI fix or a
permission grant. Remaining extra tools must still block; never invoke them to
probe denial, silently filter them, or treat controls success as workflow/
bridge admission.

At the subsequent historical exclusion-test step, the owned launch included
exact `--excluded-tools extensions_reload extensions_manage` arguments while
retaining its original source-qualified document/task allowlist and ordinary
execution permissions. That superseded mechanism is no longer emitted; current tests require Load Only,
absence of these redundant exclusions and unchanged execution permissions. Public SDK authoring documentation confirms these management
tools can scaffold/inspect extensions or stop/relaunch them; they are not exempt
inventory entries.

The single bounded CLI 1.0.95 exclusion attempt reached five connected MCP
servers, but the actual viewport still warned that both management exclusions
and both fixture allowlist selectors were unknown. It stopped before SDK
registry/tool/getter queries; the pending diagnostic marker is not mode,
inventory or callback proof. The guard now independently rejects excluded-list
warnings as well as allowlist warnings. The 52.434-second attempt retained zero
native model/target counters, unknown service usage, no task/capture, and verified
cleanup of 12 frozen identities, the owned window and listener.

GitHub's [extension documentation](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-cli-extensions)
defines `/extensions mode` **Load Only** as keeping extensions running without
agent management; **Load & Augment** is the default. Installed SDK schema uses
`load_only`, but its persisted-extension discovery is not proof of the active
launch's mode and provides no session extension-mode setter in the installed
RPC surface. No unsupported launch flag, guessed owned settings field, silent
warning exemption or generic management invocation was substituted. A supported
owned Load Only transition and effective current inventory remain actual gates,
not a ready configuration or an accepted workflow. Normal-hook attribution and
synthetic execution remain frozen until those prerequisites genuinely pass.

The offline entrypoint is `scripts/macro-eval.mjs`, with `plan`, `grade` and
`report` commands. It takes explicit corpus/evidence files and refuses output
overwrite. Planning is unexecuted; invalid/failed/blocked grades persist their
verdict and exit unsuccessfully. Reports retain incomplete trial populations.
It does not launch a native session or claim live acceptance.

### Gated native rehearsal

`native` defaults to **offline preflight**. It requires an explicit reviewed
corpus, JSON configuration, absolute shared-helper **scripts** directory and
fresh output directory. Only `--execute-live true` admits launches; schedule an
exclusive unrecorded live slot first. The controller never starts OBS.

```powershell
node scripts\macro-eval.mjs native --corpus <reviewed-corpus.json> --input <native-config.json> --console-helper-dir D:\repos\shared-config\skills\copilot-cli-obs-demo\scripts --output <fresh-owned-directory>
# Same command plus --execute-live true, ONLY in the parent's scheduled live slot.
```

Native configuration (replace executable/config paths and IDs with reviewed
values; no credentials or arbitrary environment/CLI arguments):

```json
{
  "cliExecutable": "D:\\admitted\\copilot.exe",
  "cliVersion": "1.0.95",
  "configDirectory": "D:\\repos\\TypeAgent\\ts",
  "port": 19983,
  "rootModel": "gpt-5.6-sol",
  "runnerModel": "gpt-6-luna",
  "maxTargetModelTurns": 20,
  "maxDurationMs": 300000,
  "trainingCase": "doc-source-01",
  "reuseCase": "doc-positive-01",
  "restart": false,
  "approveSyntheticReadsOnce": false,
  "reviewSyntheticDraft": false
}
```

Use an actually unused explicit port; occupied ports fail without stopping the
occupant. Explicit CLI 1.0.89 or 1.0.95 admission is verified at live start;
both always receive `--experimental`. Admission is not compatibility acceptance.
Existing built plugin/server/client runtimes and provisioned
model configuration are required; no automatic install/build/config copying.
Output owns new workspace, plugin snapshot, CLI homes, stores, private helper
configs and preallocated backend audit. Every fixture producer gets
`--append-audit`, including after service restart. A manifest hashes source,
runtime/helper files, corpus and explicit configuration, without serializing
inherited authentication. No global configuration or existing output is changed.

The journey runs an ordinary CLI baseline with routing bypassed, arms Prepare
recording in Direct mode (the recording hook delegates the selected training
interaction to ordinary Copilot), validates/reviews the exact guarded learned
two-step synthetic dependency, then tests changed-input host-controlled Direct
reuse. `restart: true` additionally closes only the owned console/service,
restarts the same owned stores and opens a fresh CLI home/session. Publication
requires `reviewSyntheticDraft: true`: this is a bounded external controller
review, not target-model self-approval or publication-UI acceptance.

Normal native tool permissions remain in force. The default stops at execution
consent. `approveSyntheticReadsOnce: true` permits only a visible one-time
synthetic lookup/fetch menu with the exact admitted tool/argument JSON, never
blanket grants, remembered approvals or inspection. Owned folder trust and the
exact `register hooks` request are admitted once; optional installation is
declined. Unknown interactions, native errors/cancellation and finite deadline/
turn bounds stop the run and preserve its verdict/evidence. Cleanup checks exact
owned process identities; it never kills shared Windows Terminal or sweeps names.
Folder trust also verifies the owned workspace's generated content against the
manifest. CLI version admission uses the executable's actual version header,
not its containing directory; a mismatched version is blocked before service or
interactive CLI startup. The version probe uses a fresh owned home and the shared
helper's sanitized child environment, and retains its non-secret observation.
Both baseline and reuse timing starts immediately before controller submission
and ends at observed native terminal proof, not at the later root user event.

Evidence comes from actual native JSONL events and independent fixture/backend
route notifications. It uses `agentId`/`data.parentToolCallId` for child identity
and causal `parentId` chains; it never appends a fabricated `session.idle`.
Missing route attribution stays unknown/blocked. Source/runtime drift, provider
usage/cost and credit ceilings remain campaign-admission responsibilities;
turn/deadline limits are not monetary caps. This rehearsal does not execute the
paired/stress plan, claim speedup, or freeze the corpus.

**Explicit blockers:** caller/MCP scoring, negative/conversation/native-tool
families, policy controls, publication UI, recording and paired/stress scheduling
are not admitted by this entrypoint. `executionPath` may only be `direct`.
Caller/MCP cannot currently be represented honestly by the grader's
grammar/miss/unknown route schema when `run_macro` executes without a grammar hit.
Nonmacro Direct literal responses can have no `turnId` or host phase report.
Actual CLI events show successful `hook.end` (`userPromptSubmitted`,
`output.handled: true`, exact `responseContent`) causally preceding the matching
root user/answer interaction. The controller retains that proof but **does not
relax the grader**; these trials remain blocked pending the owner's explicit
handled-hook completion contract. A fresh ordinary baseline/armed training avoids
depending on that unsupported completion path.

Native-controller offline regressions:

The separate `scripts/native-workiq-pilot.mjs` entry exports
`runNativeWorkiqPilot({output, config, admissionFile, admissionSha256, signal})`
for the explicitly authorized, unrecorded WorkIQ experiment. It does not change
synthetic admission or default WorkIQ denial. The exact
`user-authorized-unverified-model-exposure` override waives only complete
pre-model binary exposure assurance, not authentication, tool permissions,
frozen document identities, original-result oracles, publication or cleanup.

Its production runtime waits for the real SDK session before binding the private
policy, then requires actual initialized inventory and observer registration.
The gateway receives the existing A/B entity key before SDK bootstrap so MCP
initialization can supply source-built scalar lookup guidance. Requests are
never rewritten. The original admission retains strict request/output
semantics; a separately hash-pinned, user-authorized
`workiq-macro-correctness-v2` admission evaluates scoped document identity and
real macro generalization rather than frozen presentation/URL signatures.
Under that contract only, retrieve may omit `includeDeveloperCard` or supply a
boolean `true`/`false`; invalid types, unauthorized fields, wrong document IDs
and explicit backend denials still reject. Additive output metadata, including
contentProtection, is not a permission grant. Full-byte/current-version/library
and source integrity checks remain required. Historical admissions and outcomes
are never rewritten or regraded.
Metadata fetch requests may reorder the same unique `$select` fields under v2,
but must retain the exact scoped URL base, one selection parameter and no
additional fields, query parameters or fragment. This comparison never rewrites
requests or drafts: native consent and SDK/provider/trace joins still require
the complete actual raw arguments, including the original selection order.
The model-facing retrieve description also carries that strict source-built
guidance, while the original backend catalog remains separately fingerprinted.
Before any document prompt, the controller rereads the actual current SDK
source and checks all selected schemas and descriptions against the exposed
descriptors. Its body-free receipt distinguishes original/exposed description
hashes; metadata visibility is not model-consumption certification.
The console uses only the documented ten-key scenario environment overlay.
WorkIQ capture opt-in is an exact source-validated private control-admission
marker, not an extra environment key or a tool-permission grant; initial and
reset admission both retain that marker and the current owned control binding.
When recovering an existing cached CLI, `config.cliExecutableSha256` binds its
exact previously admitted bytes before any service launch; the actual version
probe and executable identity checks still apply to every console launch.
Before source-known SID publication, UI polling tolerates absent or incomplete
SDK event files without deriving identity from directory names. Metadata-only
policy binding also permits that pending state. The first document prompt still
requires the physically verified current SDK source, observing inventory and
one complete current-SID `session.start`; ambiguity, foreign SID, unsafe files
and unknown tool/authentication questions remain blockers. Closing the owned
console cancels its pending source/event waits without cancelling a future
same-budget console. These startup-race regressions are offline evidence, not
acceptance of the preserved blocked native attempts.
Finalized capture joins the current lease SID and all four completed recording
summary fields to the physically finalized SDK source. The manager removes the
active token when finalizing; its completed getter returns a trace, not an
active token. Wrong status, SID, summary fields or a contradictory token still
reject, and pure validation does not grant native source authority.
After current-SID event readiness, a failed selected SDK tool completion is
terminal immediately: the runtime checks the current producer and initialized
alias inventory before propagating a body-free failure. It does not wait for a
successful finalized capture that the fail-closed observer can no longer
produce. Cleanup still cancels owned source waits. Active deadline and cleanup
tail are reported separately; raw SDK turns, API calls and host submissions are
not interchangeable.
The renewed attempt reached its first A prompt but aborted when ordinary
assistant narration ("metadata to confirm the same version and complete
receipt.") matched the generic confirmation keyword. The offline classifier
remedy distinguishes that noninterrogative infinitive from confirmation
headings, direct requests, action cues and questions; unknown permission and
authentication dialogs still fail closed. Confirmation detection requires
localized dialog headings, addressed requests, imperative action cues or
questions, rather than a narration phrase allowlist or the confirmation word
alone. Progress narration, including wrapped "confirming" text, is informational;
genuine dialog cues and appended unknown questions still reject. Capture continues to reject builtin
tasks, subagents or extra tool calls rather than hiding them from provenance.
An immediate physical line ending in the infinitive word "to" is joined to its
confirmation continuation before checking directives; "You need to ... confirm"
still blocks, while line wrapping cannot invent a new imperative from narration.
Addressed requests and required-confirmation headings also retain their grammar
across physical whitespace. Replays of the preserved native frames exercise
observed viewport columns, alternative widths, and every narration word boundary;
equally wrapped directives, questions, authentication and permission prompts
remain fail-closed. No physical-screen paragraphs are indiscriminately joined.
The stock control proof joins the exact latest compiled getter to the
source-written, registered-status `spawnSync` receipt and staged router hash.
Historical getter invocations and the normal registered request hook have
different roles; their original observations remain retained and validated.
The selected current getter still satisfies the unchanged six-producer
owner/mode/digest/live-actor proof, and normal callback ancestry is proved
separately. Repeated status reads are not extra current control producers.

`runNativeWorkiqLookupDiagnostic` is a separate, non-admitting diagnostic lane,
not a shortened full pilot. It reuses the normal owned native startup, current
SDK/schema/description/event readiness and exact consent path, submits the
unchanged frozen A prompt, and stops at the first actual SDK lookup outcome or
strict failure. A source gateway quota permits at most one deep-exact frozen A
lookup upstream, rejecting and retaining extra or racing dispatches before
authorization/dispatch. The driver never resets a failed latch or performs
fetches, Prepare, publication, B reuse or macro grading. A normal recording arm
with learning off is required only to claim the original prompt and select the
existing native SDK pass-through in Direct mode; learning-off preference alone
does not claim that route. Its actual returned token/status must name the current
SID, and cleanup cancels that exact owned recording through the normal API,
verifies idle state, and preserves the recording snapshots without admission.
At most two explicitly authorized checks require separate serial owned runs,
each with its own artifacts, port, audit and exact cleanup.
An expired local pipe reader cannot prevent subsequent exact-owned console and
session cleanup. Cleanup errors remain retained separately from the final OS
release proof; post-abort SDK events are not credited as provider reproduction.
Every console allocation is tracked before launching, separately from admitted
SDK histories. Failed/partial startup retains private helper stdout, stderr,
exit/signal and exact hashed owner/state receipt bytes; it never supplies SDK
readiness or admission. Launch is cancellable and bounded by the same remaining
active budget, with the existing startup cap unchanged. Cleanup uses the pinned
normal helper to select a late exact-owned UUID window when its window receipt
is absent, then closes that window with a separate bounded cleanup allowance.
It never stops shared Windows Terminal or adopts a PID-reused/foreign bridge.
Release checks cover all allocation titles, exact actors, scoped root commands
and the receiver port, including failed launches.
Current MCP controls are selected by a private source-owned Windows process
snapshot joined to the actual bridge, CLI and SDK actor, not by desired mode or
the newest four receipts. Each stock role requires one distinct live physical
producer with exact staged script/role argv, PID/start/executable/parent tuple,
owned root/config digest and bounded observation chronology. Missing or
ambiguous roles, current conflicts, foreign actors, PID reuse and forged
chronology reject. Physically absent older producers remain historical evidence;
all observations and actor/selection snapshots are retained. Serialized snapshots
cannot supply native authority, and historical replay does not regrade a failed
trial.
The SDK producer and Node MCP/bridge producers are distinct executable roles:
the SDK producer may be the pinned Copilot binary. MCP executables must match
the actual protected Node bridge, never an assumed SDK executable. Script and
role argv are expanded from the physically pinned staged MCP manifest, preserving
its declared spelling and case-sensitive role flags; staged script bytes and
each producer's own OS tuple still must match.
The hook authentication target carries the lexical owned workspace, independently
proved mode/config digest, and original lease/submission/deadline explicitly.
Binding a reader does not fill its authentication target. None of these expected
values are copied from incoming hook stdin; missing or foreign context continues
to fail the unchanged protected callback validator.
The complete target is constructed and validated against source-proved controls
before typing the live prompt, then checked against fresh controls before receipt
authentication. Caller omissions therefore fail before any document reads rather
than consuming a workflow and discovering incomplete context at finalization.
Recording learning uses the existing boolean API contract: admitted `prepare`
maps to `true`, and `off` maps to `false`; unknown inputs are rejected, not
coerced. The independently read workspace preference and returned source token
must agree before typing. Prepare requires the actual retained learning flag and
owned cwd, then a matching finalized learning-job ID; a known missing job fails
immediately instead of waiting out the live budget. No manual Prepare rescues a
failed recording.
Owned receiver cleanup uses the same exact OS identity shutdown as the other
owned actors, without modifying the protected reader. A held process handle and
fresh lifetime/executable checks prevent PID reuse adoption. Only a precise
process-not-found error followed by authoritative PID absence is classified as
an exited-before-stop race, retaining its original error in the shutdown receipt.
Foreign/reused identities, unreadable checks, surviving actors, and genuine stop
errors still block cleanup; failed historical cleanup is never rewritten.
Future product lineages require an explicit native service-module-load witness.
Only that owned service launches with its pinned staged `--import` observer and
private spawn IPC channel; no global `NODE_OPTIONS`, product hook, or API changes
are made. The observer returns normal Node loader results unchanged and emits
only actual loaded-source hashes/lengths for the declared service entry and five
qualified product modules. It does not force imports, inventory unrelated
modules, expose source bodies, or certify module evaluation/model consumption.
The lexical callback joins these observations to the actual current OS
PID/birth/executable/parent/exact argv, owned root, qualified manifest, observer
bytes, and private launch-plan digest/nonce. Missing, duplicate, stale, foreign,
changed-byte/path/manifest, and extra-authority records fail before typing.
Chronology uses shared OS monotonic nanosecond ticks from the real load callback
and private receiver, not millisecond wall-clock ordering. Local Windows child
tests observed a one-millisecond cross-process `Date.now()` inversion; no clock
tolerance or new timeout admits it. Forged prelaunch/future monotonic ticks still
fail. Wall-clock timestamps are display metadata only.
Snapshots cannot mint the private receipt brand. Existing normal listener/RPC,
SDK/current-control, recording-preference/token, and callback-target checks still
apply separately; startup and preprompt checks use the same active budget.
Full provider originals and all actual SDK events are retained; provider
delivery is not falsely claimed as a proven full SDK result. An empty lookup
still fails without inventing a binding; source error specificity distinguishes
`emptyLookup` from multiple-hit `nonuniqueLookup`, without regrading history.
The failed attempt and its transport
errors remain immutable evidence, not a successful provider read or permission
denial diagnosis. A subsequent authorized attempt passed startup and omitted
DeveloperCard, but its changed query failed the frozen request contract; the
observer then correctly denied a retry after that failed completion. A separate
terminal UI false positive joined "selected document" in the echoed prompt to
"binary/model" in the later error. The offline classifier now detects model
choosers only from localized directive/heading evidence, including an immediate
wrapped model label, rather than matching across unrelated viewport text.
Confirmation narration also cannot borrow a later unrelated question mark;
actionable questions, real choosers, authentication, unknown permissions and
confirmation/cancellation prompts still block. These new regressions do not
qualify a live workflow or resolve the independent frozen-query failure. The
actual failed results remain immutable; no further live budget or recording is
implied.
The later user-authorized v2 contract supersedes those strict signature/omission
rules only for new trials. Semantic request matching never changes the raw
SDK/provider/trace joins: the native read actor and projection still compare
complete actual arguments, including the optional diagnostic boolean, exactly.
The admission is validated before runtime creation, and each trial records its
evaluation contract and intentional authorization lineage. Grammar routing,
source macro bindings, original-result provenance and actual current-SID
readiness remain independent requirements.
The current Agency catalog supplies schemas and read-only annotations; SDK
aliases are independently joined. Controller trial leases are not product macro
run IDs. A private source-branded projection preserves the complete physical
trace and excludes only the independently proven parent macro task on reuse;
unknown calls remain blockers. The workflow captures frozen A, awaits its real
Prepare job, reviews the exact draft, publishes through the supported API, then
requires current B grammar reuse. A real owned service restart is attempted only
with remaining turn/time budget. Results are experimental functional evidence,
never certified model-consumption proof. OBS is outside this entry and must wait
for actual functional acceptance.

```powershell
node --test scripts\test\macro-eval-native.spec.mjs
```

### Consolidated staging and restriction preflight

Canonical staging now bundles the **current compiled** hook/MCP dependency
graphs into the owned snapshot, retains the complete dist runtime/assets and
guidance, and records dependency and unchanged-extension hashes. It handles both
thin tsc output and already-bundled entries; a distinct createRequire binding
avoids collisions with the product bundle's existing banner. Both executable
entries must pass Node syntax checks before a manifest is admitted. Missing
dependencies, changed closure inputs, extension drift, failed native hooks,
unrecognized availability names and failed MCP initialization block tasks.
Startup must report the complete configured plugin-plus-fixture MCP catalog,
not just a session header. The generated workspace has its own empty Git root
to stop parent-repository instruction discovery; this is not a security boundary.

The exact model-availability selectors are
`mcp:macro-eval-docs-lookup_document`,
`mcp:macro-eval-docs-fetch_document`, and `builtin:task`. These are
source-qualified SDK wire-name selectors, **not execution approvals**. There
are no new allow-tool/allow-all grants or permission inheritance. CLI 1.0.95
accepted these selectors without unknown-name warnings in the single zero-model
diagnostic; unrelated tools were visibly disabled and Manual Approval remained.
Actual native unrelated-tool denial/non-autoapproval still needs a separately
authorized invocation; fixture rejection alone does not prove native permissions.

For a scheduled **zero-model diagnostic only**, set `diagnosticOnly: true`,
`maxTargetModelTurns: 0`, `maxDurationMs` at most `180000`, and `restart: false`
in the same native configuration. It checks compiled status-hook IPC, the
audited fixture catalog and an unrelated fixture-operation rejection, then
native startup. It never submits native commands/tasks or performs capture,
Prepare, publication or reuse. Even successful startup remains blocked on the
unproved native negative permission/exposure gate. Deadline cleanup has its
own finite Close allowance, independent of the exhausted task budget.

The actual diagnostic retained zero native model turns, user messages and tool
calls. Hook status IPC and exact OS listener ownership passed. Four plugin MCP
processes failed because the first staging revision rebundled an already-bundled
entry with the same `__cr` banner binding; the original result remains
harness-invalid after its deadline/Close timeout. The corrected helper passes
isolated missing-dependency/banner/hash regressions and real initialize-only
handshakes for all four current MCP modes without a service or model. **No
interactive CLI rerun after that correction had been executed at that handoff.** Separate
cleanup verified all 15 owned identities, the owned HWND and the port cleared.
This is startup correctness evidence, not macro acceptance or a speedup result.

The next authorized single corrected CLI 1.0.95 rehearsal passed admission,
current closure/syntax/hash checks, exact listener ownership, owned workspace
trust/hook registration, and **all five** configured MCP connections. Exact
source-qualified availability selectors produced no unknown-name warnings.
It stopped at the first baseline: the controller's owned config contained
`mode: bypass`, but the successful native hook actually handled the synthetic
document request through TypeAgent, returning empty conversation-corpus/search
results instead of fixture content. The fixture audit stayed empty. This proves
a runtime mode-control/binding mismatch, not its exact environment/path cause;
the effective runtime config path has not been independently observed. Do not
repair it by writing global config, relaxing completion grading, or approving
additional tools. A future metadata gate must prove effective mode and owned
config-path binding before task submission.

The original baseline remains blocked: no required lookup/fetch, changed binding,
full content or supported native completion. Capture, Prepare, external review,
publication and reuse were not reached. Controller-submit-to-observed-answer
was 51.884s; startup was 56.156s, not a speed comparison. There were zero
canonical native target-turn events, plus one separate persisted
`model.turn_started`/model-call telemetry record for `gpt-4o-mini` after the
observed answer; its purpose is unproved and service translation usage is
unknown. Selected root Sol/runner Luna configuration does not prove those models
executed. Exact cleanup independently cleared 13 owned identities, the HWND and
port 19990. No retry/rescue or WorkIQ wiring was performed.

```powershell
node --test scripts\test\macro-eval-native.spec.mjs scripts\test\macro-eval-staging.spec.mjs
```

The first authorized unrecorded admission attempt on October 12 was **blocked
before any model turn**: its inherited-context version probe reported CLI
**1.0.95**, while the manifest required 1.0.89. The subsequent explicitly
authorized 1.0.95 attempt was also blocked before startup: the now-isolated,
`--no-auto-update` probe of the configured `1.0.89` executable reported **1.0.89**.
The independent binary metadata also identifies that file as 1.0.89. A separate
installed WinGet executable has 1.0.95 metadata and a different hash; it was
identified without launching another rehearsal. The earlier unsanitized probe
is not proof of a binary's isolated runtime identity. The exact cause of its
different output has not been isolated between inherited context and automatic
update handling.

Neither attempt started a service, interactive terminal, fixture call,
publication or OBS session. No 1.0.95 extension/API/event or task compatibility
was accepted. Use the actual resolved binary path and schedule another slot
explicitly; the controller does not update binaries, inherit permission flags,
silently choose a PATH fallback or change the required version. Version evidence
retains resolved executable path, SHA-256, explicit expectation and actual header.

The corrected WinGet-path attempt subsequently **passed 1.0.95 version admission**
with the same isolated home/workspace/environment and `--no-auto-update` used for
the real launch. The final executable SHA-256 was frozen and rechecked. It then
stopped at service readiness: stdout advertised port 19985 and the TCP probe
connected, but the OS listener-ownership query returned no listener. No interactive
CLI, task, recording, publication or macro execution began.

Readonly source inspection also confirmed that agent-server runs an owned
supervisor/worker pair; the controller had incorrectly required the listener PID
to equal the supervisor PID. The controller now checks exact supervisor identity
and actual worker ancestry, retains bounded listener observations, and never
accepts an unrelated listener or skips missing ownership proof. Numeric child
exit codes are normalized to harness-invalid verdicts rather than copied into
evaluation status. These fixes passed offline regressions; the original failed
attempt and its numeric raw verdict remain unchanged. No second live attempt was
made, and 1.0.95 extension/API/event or macro lifecycle compatibility remains
unaccepted.

Subsequent offline Windows probes reproduced the missing listener proof on a
fresh, owned disposable loopback socket: the CIM instance's raw `State` was `0`,
its displayed state was null, and `Get-NetTCPConnection -State Listen` returned
no match. This is separate from the supervisor/worker PID defect. The controller
now requests the native Windows `GetExtendedTcpTable` **listener-only**
`TCP_TABLE_OWNER_PID_LISTENER` table directly, instead of guessing or fabricating
a state. The native API's raw state is retained unchanged (also `0` on this
platform); listener classification comes from the requested OS table. Real
Windows tests verify that this table includes the actual listener and excludes
both established same-port connections and bound-but-not-listening sockets.

Readiness requires exactly one OS-classified listener on the explicit port and
`127.0.0.1`, and stable PID, parent PID, creation time and executable path for the
entire owned supervisor/wrapper/worker ancestry across process snapshots taken
before and after the OS query. Children predating their parent, missing paths,
changed identities, unrelated owners and widened bind addresses stop the run.
Service launch explicitly passes `--host 127.0.0.1`. OS/API/permission failures
block rather than falling back to a banner or TCP handshake. Windows PowerShell's
native-API compilation scratch stays inside the owned output directory. No
shared-helper change is required. These are offline OS fixtures, **not** a
TypeAgent service/model rehearsal or live macro acceptance.

The next single unrecorded 1.0.95 attempt used the updated matched product:
fresh macro/provider/plugin source and built-runtime hashes were retained,
and the staged extension was checked against the current built extension.
Actual service listener ownership passed. Exact owned-workspace trust was
accepted once, but the controller falsely rejected the unchanged
`register hooks`-only permission prompt because its padded box border matched
the extra-scope guard. The attempt stopped before extension approval or any
target turn, fixture call, capture, Prepare, review or publication. Owned process
identities and the port were verified clear. The parser now removes presentation
borders and compares the complete scope paragraph exactly; multiline extra
scopes remain blocked. This fix is offline-tested only, with no retry or live
extension/lifecycle acceptance implied.

The corrected attempt reached an actual ordinary baseline: native CLI 1.0.95
selected Sol 5.6, performed three native model turns and exactly the synthetic
lookup/fetch calls, returned full content with fresh ID binding, and emitted
root-turn completion. Its grade remained blocked because route attribution was
unknown. The native hook reported `ERR_MODULE_NOT_FOUND` for `hook-direct.js`:
the current hook router was a thin `tsc` artifact with relative imports, while
the stage helper requires self-contained bundles. Matching the extension alone
did not establish a complete portable hook/MCP runtime. The ordinary CLI
continued after that failed hook; this is not accepted fallback evidence.

The controller now checks copied hook/MCP entry-point imports without executing
them, rejects unbundled artifacts before service/CLI launch, and stops on failed
native hooks or unresolved tool-allowlist warnings. Rebuild the product plugin
bundles **last**, after dependency-aware `tsc` builds; the controller never repairs
product files or broadens permissions. The observed CLI also warned that the
configured synthetic allowlist names were unknown during startup, despite
subsequently executing tools with those exact names. Exact restriction readiness
therefore remains a separate admission blocker; do not suppress the warnings or
infer a corrected spelling. No capture/Prepare/publication/reuse ran, and the
owned processes/window/port were cleared. These new guards are offline-tested,
not a retry or live acceptance.

The offline modules include:

- `scripts/macro-eval-corpus.mjs` and `scripts/macro-eval-fixture.mjs`: validated
  reviewed scenarios and an audited local document MCP using corpus identities.
- `scripts/macro-eval-grade.mjs`: independent content/binding, route and native
  completion checks; unsupported families or missing evidence cannot pass.

- `scripts/macro-eval-plan.mjs`: explicit models and turn/deadline bounds, reviewed
  case IDs, seeded paired order, fresh-session/store requirements and a distinct
  warm/restart stress schedule. Performance campaigns measure one family at a
  time; scheduler seeds are not model sampling seeds.
- `scripts/macro-eval-report.mjs`: keeps missing/failed/blocked/harness-invalid
  trials in reporting, checks identical trial identities/timing boundaries, and
  computes paired observations only for correct grammar-hit reuse. Preparation
  overhead must be known for positive break-even estimates; nonpositive savings
  have no observed break-even. Unavailable provider usage/cost remains unknown.

Run their offline tests from this package:

```powershell
node --test scripts\test\macro-eval-plan.spec.mjs scripts\test\macro-eval-entrypoints.spec.mjs
```

An offline plan can be generated from any working directory using absolute
entrypoint/corpus/output paths. For example, from this package:

```powershell
node scripts\macro-eval.mjs plan --corpus <reviewed-corpus.json> --output <new-plan.json> --mode paired --cases doc-positive-01 --repetitions 10 --seed 17 --root-model gpt-5.6-sol --runner-model gpt-6-luna --max-target-model-turns 100 --max-duration-ms 600000
node scripts\macro-eval.mjs grade --corpus <reviewed-corpus.json> --input <native-evidence.json> --output <new-grade.json>
node scripts\macro-eval.mjs report --input <campaign.json> --output <new-report.json>
```

Angle-bracket values are placeholders, not literal PowerShell arguments. Grade
input supplies a `scenarioId` and actual `events`, `backendAudit`, `answer`,
`routeEvidence` and `executionEvidence`; it cannot override the corpus oracle.
Report input contains the saved `plan`, `results` rows and optional complete
`preparation` timing. The native adapter must collect these inputs; do not
fabricate evidence to make a grade pass.

These tests do not start Copilot, services or OBS, spend a live campaign budget,
or demonstrate a speedup. Turn/deadline limits are not monetary caps and do not
account for preparation/service-side model work. The old evaluation ledger and
spending authorization must not be inherited by the macro campaign.

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
