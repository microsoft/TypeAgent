# git-story

Attaches the agent sessions that led to a commit to that commit. This package
includes a CLI, local daemon, and Session Watcher lifecycle; commit-story generation
is not implemented yet.

Git runs any `git-<name>` binary on `PATH` as `git <name>`, so the
`git-story` binary is also `git story`.

```text
$ cd ts/packages/git-story
$ pnpm build
$ npm link            # puts git-story on PATH
$ git story init   # registers Copilot CLI and git hooks for this repo
$ git story hooks copilot user-prompt-submitted  # receives Copilot JSON on stdin
{}
$ echo input | git story hooks git pre-commit a b
git-story pre-commit: received 2 arguments
```

`init` registers the `userPromptSubmitted`, `sessionStart`, and `agentStop`
Copilot hooks in `.github/copilot/settings.local.json` and adds that
file to `.git/info/exclude`, so it stays local to the clone.

`init` also writes `pre-commit` and `prepare-commit-msg` scripts to the git
hooks directory (honors `core.hooksPath`). Each script runs
`exec git-story hooks git <hook> "$@"`,
so git's hook arguments and stdin reach the command unchanged. `init` does not
overwrite a hook that it did not write.

`prepare-commit-msg` appends a `typeagent` line to the commit message, once.
This is a placeholder for the git-story summary.

## Daemon

`git story daemon start|stop|restart|status` manages one HTTP server and **one
SessionWatcher** per user, shared by all projects and sessions. The default is
`127.0.0.1:51703`. Private local state is under `~/.typeagent/git-story`;
`daemon.json` atomically contains the PID, bound port, and random per-instance
credential. `daemon.lock` exclusively owns that state directory, even when a
different port is requested. Logs are `logs/yy/mm/dd/daemon.log` and `cli.log`.
Use a user-private state directory and protect its inherited Windows ACLs;
POSIX directories/files are created with modes 0700/0600.

**Compatibility change:** all HTTP routes now require the local bearer credential,
including identity, operational status and Git commit reads. The shared typed
`daemonClient` transparently reads the credential/port from `daemon.json`; old
unauthenticated curl clients must migrate. Credentials never go in CLI arguments.
Loopback Host validation rejects DNS rebinding, and Origin/cross-site browser
requests are rejected even with a credential. JSON mutations have a 64 KiB body
limit and bounded transport timeouts; rejected values and dependency exceptions
are not echoed. Git-story commit read semantics remain unchanged.

### Explicit trusted composition

There is **no production privacy policy or delivery destination**. Without an
adapter the daemon serves reads, but registration fails with 503 before
capture. Startup environment variable `GIT_STORY_ADAPTER` must name an absolute
local module file exporting:

```typescript
export function createSessionWatcherDependencies(): {
  privacyFilter: SessionPrivacyFilter;
  approvedUpdateDestination: ApprovedUpdateDestination;
} {
  return {
    privacyFilter: applicationPrivacyPolicy,
    approvedUpdateDestination: applicationDestination,
  };
}
```

The factory may be async. Both functions are validated; only those two fields are
selected. This is **trusted executable application code**, not a sandbox/plugin
download or an HTTP option. Hooks cannot select adapters. Detached startup
inherits the explicit environment; repeat that configuration for subsequent
start/restart commands. Adapter load failures abort startup without echoing module
exceptions. Actual Neumem extraction/story building remain out of scope.

Local-only configuration (never accepted over HTTP):

| Variable                 | Default                  | Purpose                                               |
| ------------------------ | ------------------------ | ----------------------------------------------------- |
| `GIT_STORY_STATE_DIR`    | `~/.typeagent/git-story` | Absolute private daemon/receipt/capture/log directory |
| `GIT_STORY_COPILOT_HOME` | OS home                  | Absolute home containing `.copilot/session-state`     |
| `GIT_STORY_PORT`         | `51703`                  | Loopback port; `0` selects an ephemeral port          |
| `GIT_STORY_MAX_RECORDS`  | `1000`                   | Complete records per batch, integer 1–1000            |
| `GIT_STORY_ADAPTER`      | unset                    | Absolute trusted local composition module             |

### Hooks, admission and status

The real Copilot `sessionStart` input uses camelCase `sessionId` and `cwd`.
The hook resolves the Git project root, submits through the shared client, and
always returns `{}`. Invalid/missing daemon/input and 2-second HTTP timeouts are
reported generically without interrupting the agent. Neither prompt submission
nor **agentStop** ends monitoring: agentStop means a turn ended, not a session
ended. Hook stdin is bounded; no prompt, tool content, or raw input is logged.
`init` preserves user settings and hooks and updates only exactly owned entries.

`POST /api/sessions` returns **202 starting**, not ready or successfully delivered.
The daemon drains asynchronously so a slow initial destination does not exceed the
hook timeout. Repeated identical registrations share the existing admission;
changed project/seed metadata is a 409 conflict. Projects use filesystem-canonical
absolute directories; session IDs must be safe single components on Windows and
POSIX. Managed capture supports only `copilot-cli`, deriving
`<home>/.copilot/session-state/<sessionId>/events.jsonl` unless the authenticated
registration supplies an explicit absolute `transcriptPath`. Existing source
ancestors are canonicalized (including directory symlinks/junctions) even for a
missing file; aliases cannot assign the same source to another session.
Explicit sources must contain Copilot CLI event records, not arbitrary native
transcript formats. No adapter can be selected through HTTP or hook input.
At most 1024 retained sessions are admitted.

**VS Code compatibility limitation:** `init` also preserves/registers the incoming
`.github/hooks/git-story.json` `SessionStart` hook, and `hooks vscode session-start`
preserves `session_id`, `transcript_path`, and workspace `cwd` in registration.
There is no native VS Code transcript normalizer. The daemon explicitly rejects
`vscode-copilot` with **503 unsupported transcript format before capture**, even
when it supplies an absolute path. The hook warns safely and returns `{}` so the
agent continues. This is hook/transport compatibility, **not functional VS Code
capture**. Unknown clients cannot enable capture by supplying a path either.

Authenticated `GET /api/sessions`, exposed by `git story daemon sessions`, reports
identities/source locations, starting/active/blocked/stopped admission state,
lifecycle phase, monitoring, read checkpoint, diagnostic codes/ranges and failure
receipts, **never event payloads or registration metadata**. Active plus
`phase: waiting` means monitoring a missing file/parent, not successful capture.
Ownership checks compare incoming canonical paths with persisted source identities,
without probing every historical source. An inaccessible old source does not block
unrelated registrations. Changing symlink/junction targets after registration is
unsupported; historical alias recovery is deferred. On Windows, equivalent path casing reuses the original
persisted transcript spelling for checkpoints, capture state and generated IDs.
`GET /api/daemon` exposes PID, configured, and stopping.

```text
$ git story daemon start
$ git story daemon register <absolute-project> <copilot-session-id>
$ git story daemon sessions
$ git story daemon stop
```

`POST /api/daemon/stop` closes admission/notifications immediately, drains admitted
pipeline work/current delivery, then closes HTTP and removes only its owned state.
It does not use SIGTERM to terminate Windows processes. A drain can stop between
batches, leaving unread backlog for restart. CLI stop waits up to ten seconds;
if a dependency is still running it reports **still stopping**, never force-kills
or deletes live ownership. Repeated stop is idempotent. There is no force-kill CLI.
After a crash, an abandoned lock is intentionally not stolen: an operator must
verify the recorded owner has exited before removing that exact lock offline.
A matching live PID alone is not sufficient proof of daemon identity.

### Failures and supported recovery boundary

The supported workflow is one daemon monitoring local append-only Copilot CLI
transcripts. Clean stop/restart resumes bounded reads and restores metadata without
republishing old events. Atomic receipts retain failures; a persisted processing
phase left by an interruption also becomes **blocked**, with `recoveryRequired: true`.
Repeated registration or restart never clears that block or skips to later records.
Other sessions continue independently.

**Fine-grained replay is not implemented.** There is no daemon replay CLI/API,
failure-range recovery, or automatic clearing of blocked sources. TODO: design
explicit operator reconciliation before supporting replay. Preserve the transcript,
capture state and receipt for manual investigation and reconciliation with the
configured destination; do not delete state or change the session ID to bypass a
block. No supported in-product unblock operation is provided.

**Read progress is not delivery acknowledgement.** Capture precedes delivery and a
destination can accept an update before failing. A processing read cursor is not a
safe retry boundary. Receipt-write failure can prevent the latest failure from
reaching disk; live status retains `reportingFailed`. There is no delivery journal
or crash-exact guarantee. TODO: arbitrary transcript rewrites, concurrent direct
capture from other processes and historical alias retargeting are outside the
single-owner append-only contract.

### Reproducible real CLI proof

After building this package and its dependencies, from the package directory:

```text
node scripts/daemonIntegrationDemo.mjs
```

This assertion-driven script starts the **compiled CLI's real detached daemon**,
runs `init` and real hook stdin, uses real authenticated HTTP and temporary JSONL
files, and verifies waiting, bounded batches, partial tails, two sessions,
redaction, duplicate hooks, delayed-delivery shutdown, metadata restoration without
old-event publication, persistent failure/interruption blocking, rejection of the
removed replay command/API, and HTTP rejection.
The interruption proof copies real receipt/capture files while delivery is pending,
then drains/stops the original process before starting the isolated snapshot.
Its adapter is explicitly a **fixture-only allow-list filter and fsynced temporary
sink**, not a production privacy policy or extraction service. It prints actual
commands/results and cleans its isolated repository/home/state/adapter/sink and
processes. It never reads real user transcripts or touches the existing user daemon.

### Teammate live-session proof

Build once from `ts/`: `pnpm exec fluid-build git-story -t build --dep`.
From `ts/packages/git-story`, deterministic synthetic validation is:

```text
node scripts/daemonIntegrationDemo.mjs
node scripts/liveSessionWatcherSmoke.mjs
```

To monitor **your explicitly selected** Copilot CLI conversation, copy its session
ID from your CLI/session UI or the name of its known
`~/.copilot/session-state/<id>` directory. The script never discovers or scans
sessions. Use `--transcript <absolute-path>` if your transcript lives elsewhere.

```text
node scripts/liveSessionWatcherDemo.mjs --help
node scripts/liveSessionWatcherDemo.mjs --session <your-session-id> --duration 120
```

The optional `--output-dir <absolute-directory>` selects a new evidence location.
By default, a uniquely named evidence directory is created under the OS temporary
directory and printed. Existing evidence logs are never overwritten. Operational
daemon state is separate and temporary; it is cleaned after graceful shutdown,
while evidence remains. No shared daemon, hook configuration, transcript, Azure
credential or private adapter is changed. The harness launches the compiled
daemon entry with isolated ownership, an ephemeral loopback port and authenticated
registration. It requires no model/feed credentials at runtime.

The default initial history limit is **32 MiB**. Larger transcripts fail with
guidance to raise `--max-history-bytes`; no history is silently skipped. All history
within the limit is drained in `--batch-size` batches (default 100, maximum 1000).
Later appends continue until Ctrl+C or the finite `--duration` expires
(default 0 means Ctrl+C). A marker does **not** stop the watcher.

After `LIVE` appears, send a user message consisting only of
`LIVE-WATCHER-CHECK-<unique-label>` (letters, digits, `_` and `-`, up to 80 label
characters). Each such marker with a native event ID produces an immediate
receipt linking its exact text and ID to its logged batch. Ordinary event output
is aggregated every two seconds to avoid a console feedback storm.

```json
{"kind":"REGISTERED","state":"starting"}
{"kind":"LIVE","batches":3,"events":217,"markers":0}
{"kind":"MARKER","batch":4,"nativeId":"event-id","id":"event-id","marker":"LIVE-WATCHER-CHECK-demo","log":"batches.jsonl"}
```

Output also distinguishes `WAITING` (check the selected path/session), `CATCH_UP`,
`BLOCKED`, `STOPPING`, and `STOPPED`. Counts are observations, not a percentage
coverage claim. `batches.jsonl` retains **every** approved batch in order, with
batch number, timestamp, session ID, event/model counts, safe event/native IDs,
categories, and allowed markers. `receipts.jsonl` records operational snapshots;
`proof.jsonl` retains all console receipts. There is no “last five” truncation.
Raw assistant/user/tool text, arguments, results, filenames, model names and other
semantic metadata are excluded from batch evidence. Configuration and operational
receipts intentionally identify the selected local source path.

The bundled structural allowlist is a **test fixture, not production privacy**.
It accepts marker text only when the entire user message matches the narrow
pattern; native IDs containing characters outside the fixture's safe ID alphabet
are omitted. Source failures remain blocked, with no supported automatic recovery.
If shutdown cannot drain within 15 seconds, the script reports `STILL_STOPPING`,
retains ownership state, and does not force-kill. Portable Node APIs are used;
the synthetic child-process smoke has been executed on Windows, not claimed as
executed on macOS/Linux.

## Session Watcher

The Session Watcher reads GitHub Copilot (GHCP) CLI transcripts to gather context
for commit stories. Its responsibilities are to:

- Capture new session activity, including conversations and tool use.
- Normalize events into a common format, keeping the original event ID when
  available or assigning a GUID when it is missing.
  Keep the session context and any recorded edit diffs.
- Pass events and metadata through a separate privacy filter before sharing them
  with memory processing.
- Collect session metadata, such as the client, models, timestamps, and related
  sessions.

The watcher supplies this context; the Story Builder decides what belongs in
each commit story.

To resume reading, the watcher saves the session ID, transcript file, and byte
offset after the last complete record. This tracks what it has read, not what
downstream memory processing has finished.
Generated IDs are saved separately with their transcript
locations so rereading an event reuses its assigned ID.

### Batch capture

`SessionWatcher.captureUpdates(request, checkpoint?, options?)` delegates to
`captureSessionUpdates` in `src/sessionCapture.ts`. Batch capture, normalization,
metadata collection/restoration, and the privacy/approved-update boundary are
implemented, as are the managed watch/process/stop methods described below.
Production privacy policy and delivery are injected dependencies. These batch
methods start no monitoring; the daemon above uses the managed lifecycle. A
VS Code transcript adapter is not implemented.

### Managed lifecycle

`new SessionWatcher({ privacyFilter, approvedUpdateDestination, capture?,
reconcileIntervalMs?, onStatus? })` manages multiple project/session registrations
in one process. `capture` accepts `stateDirectory` and `maxRecords`; defaults are
the batch capture defaults. Both privacy and destination dependencies are required
before lifecycle capture, even if a filter might exclude all updates. No default
pass-through policy or no-op destination is supplied. No-argument construction
still supports the independent batch helpers.

- `watch(request): Promise<void>` establishes filesystem notifications and drains
  existing complete records in bounded batches. It resolves after that initial
  catch-up, **not** at session end. If the file or its parent does not exist yet,
  monitoring is established on the nearest existing ancestor and readiness is
  explicitly `phase: "waiting", monitoring: true`. This is not a claim that capture
  succeeded. Permission, configuration, and initial processing failures reject.
- `processUpdates(request)` uses the same
  per-source queue as watch notifications and drains complete-record backlog,
  returning a **read checkpoint**, never a delivery acknowledgement. It resumes
  from persisted read progress; arbitrary cursor replay is not a lifecycle API.
- `getStatus(requestIdentity)` returns a detached snapshot or `undefined` for an
  unknown registration. Status phases are `waiting`, `processing`, `idle`,
  `failed`, and `stopped`; `monitoring` distinguishes watched from direct-only
  sources. Status includes generation/read checkpoint, the last nonempty
  diagnostics batch, a cumulative diagnostic count, and any failure evidence.
- `stop()` immediately closes notifications and timers, then waits for admitted
  work and its current delivery. A drain may stop between batches; remaining
  backlog stays unread. Repeated calls are safe. **Stop is terminal**: create a
  new instance to resume; watch/process reject after stop. Failure evidence is
  preserved after stop instead of being replaced by a healthy/stopped status.

Identical registrations are idempotent. Changing a registered project/session's
transcript or seed metadata rejects; assigning the same session/transcript capture
source to a different project also rejects, because they would share a read cursor.
The registration seed is copied and never replaced with accumulated observations.
One daemon owns the local append-only Copilot CLI transcripts. Its queue serializes
all managed work for each capture source. Unmanaged capture or another watcher
must not process the same source concurrently.

Filesystem notifications are coalesced. A stat-based reconciliation timer (default
1000 ms) compares file identity, size, and high-resolution timestamps, recovering
missed notifications, file creation, and replacement/recreated parents. Unchanged
files and permanently partial tails do not trigger capture every tick. Filesystem
watch errors fail that registration explicitly. Arbitrary in-place history rewrites
are outside the append-only contract.

On first processing after restart, metadata is privately restored through the
first consumed record's boundary, including malformed-record diagnostics. Current
records are then normalized and processed normally; restoration never publishes
history. A generation change discards old observations. Metadata-only output is
filtered/delivered once per initialized generation and thereafter only when
metadata meaningfully changes. Events always pass the actual whole-update
`filterForPrivacy` method, and only its opaque approval handle reaches
`publishUpdate`. `null` is intentional exclusion, not processing failure.

`onStatus(identity, status)` receives sanitized local operational evidence,
including every diagnostic batch (also batches without events). It contains source
paths and IDs but never transcript payloads, metadata content, dependency error
text, or exception causes; it is not privacy-approved external output. Keep this
callback local. Async callbacks are awaited; do not await reentrant watch/process/
stop calls from callbacks or pipeline dependencies. A callback throw/rejection
fails that source closed with `reportingFailed: true`, retrievable via `getStatus`.
If reporting a processing failure also fails, the original failure is retained.
Without a callback, callers must inspect status for background failures.

Processing failures are **terminal for that source in this instance**. They close
monitoring and block later processing rather than silently skipping into subsequent
batches. Status retains the stage and read progress; `captureMayHaveAdvanced` is
conservative when capture itself throws. Capture persists before delivery, so
restarting with the saved read cursor is **not delivery recovery**. The owning
daemon must persist a blocked registration after failed/interrupted processing
rather than automatically resuming it. TODO: add operator recovery for failed
delivery if needed; fine-grained failure replay is deliberately deferred. There
is no durable ingestion queue, automatic retry, or exactly-once guarantee.

Standalone synthetic evidence (compiled module, real temporary JSONL files,
fixture-only allow-list filter and in-memory destination):

```text
node scripts/sessionWatcherDemo.mjs
```

The demo asserts waiting readiness, bounded catch-up, redacted output, stopped
notifications, restart metadata restoration without old-event publication, and
explicit failure isolation without silently advancing later batches. It never reads user
transcripts or starts the user's daemon. For full CLI/daemon/hook evidence use
`daemonIntegrationDemo.mjs` above. Production privacy policy/destination remain
separate work.

**Supported workflow:** local, append-only Copilot CLI transcripts owned by one
daemon. The daemon owns cross-process exclusion; standalone capture callers must
not run concurrently in different processes. This is a common-workflow scope,
not a measured coverage percentile. Event classification and privacy safeguards
are unchanged by this constraint.

With no checkpoint, capture loads the saved cursor. `options.stateDirectory`
defaults to `~/.typeagent/git-story/capture`. `options.maxRecords` defaults to
1000 and limits complete source records examined, including malformed lines.
Only LF-terminated records are consumed; CRLF is supported. An unfinished tail,
including an incomplete UTF-8 character, stays unread until its LF arrives.
Offsets count UTF-8 bytes, not characters.

The exported `CapturedSessionUpdates` contains:

- `records: CapturedSessionRecord[]`: each envelope has the assigned `id`,
  optional native `sourceEventId`, `source`, and unchanged parsed JSON `payload`.
  Native string IDs are preserved verbatim; otherwise capture assigns a random
  GUID. Generated IDs are never inserted into `payload` or `sourceEventId`.
- `source: SessionCaptureSource` on records and diagnostics: `sessionId`,
  `transcriptPath`, `generation`, and decimal `sourceByteOffset` at the **start**
  of the record.
- `nextCheckpoint: SessionCaptureCheckpoint`: `sessionId`, `transcriptPath`, and
  decimal `sourceByteOffset` immediately **after** the last complete record
  consumed in this batch.
- `generation: string` and `diagnostics: SessionCaptureDiagnostic[]`. Diagnostics
  contain only a code and source location, never raw text or parser errors.
  `invalid-json` and `invalid-utf8` records advance the cursor but are not returned
  as events. Callers must surface these diagnostics; valid JSON of an unsupported
  event shape is preserved for normalization to diagnose. `source-reset` reports
  a new transcript generation.

The atomic state file saves both generated IDs (keyed by generation and record
offset) and the read high-water checkpoint **before capture returns**. This is
read progress, not downstream ingestion acknowledgement. Normal restart loads the
saved cursor and restores metadata from the already captured prefix. The low-level
checkpoint API remains available (nonzero cursors require `expectedGeneration`),
but it does not implement delivery retry or guarantee downstream idempotency.
Keep transcript and state together; deleting state loses generated-ID assignments.

File identity and observed length detect basic replacement or truncation.
Automatic capture starts a new generation with a `source-reset` diagnostic;
generation-bound replay rejects the changed source. Changes observed during
capture reject the batch without saving progress. Polling reads from its cursor,
not the entire history. **In-place rewrites and truncate-and-regrow between
observations are unsupported and may go undetected.** No content digest or
snapshot-consistency guarantee is provided for those inputs.

State is private local capture data, not privacy-approved output; do not log or
publish raw envelopes. Files use exclusive creation and restrictive modes where
supported, then flush and rename a same-directory temporary file over the prior
state. Write/flush/rename failures reject capture and leave the previous state
intact. This is atomic file publication, not a cross-platform power-loss durability
guarantee. Process-local exclusion rejects overlapping capture/replay operations
on the same state file and releases on failure. It creates **no persistent lock**:
a killed owner cannot block restart. Legacy `.lock` artifacts are ignored, not
deleted. A crash before publication may leave an unused uniquely named `.tmp`;
it is never loaded as state. Existing version-1 states retain their IDs/cursor;
their obsolete digest field is ignored and omitted on the next save.
Corrupt or unreadable state still fails closed rather than discarding IDs.

TODO: separately design concurrent multi-process capture, historical path-alias
recovery, arbitrary transcript rewrite recovery, and fine-grained failed-delivery
replay. None is implied by successful append-only capture.

### Normalization

`SessionWatcher.normalizeEvents(request, captured)` returns a
`NormalizedSessionBatch`: `events`, `diagnostics`, `generation`,
`nextCheckpoint`, and optional `lastEventTimestamp`. It consumes capture
envelopes, not raw JSONL or native VS Code records. It never generates IDs:
`id` is copied from capture, including an empty native string ID.
`sourceEventId` is copied only when capture supplied it.

Supported messages are `user.message`, `assistant.message`, and
`system.message`, with text in `data.content`. Assistant maps to role `agent`.
Optional source timestamps, models (`data.model` or top-level `model`), and
`agentId` are retained. Optional `parentId`, `parentToolCallId`,
`parentAgentTaskId`, message/originating-message, turn, interaction, and request
IDs retain exact source relationships; session identity belongs to the enclosing
update. Messages retain attachment references/selected text, tool requests and
citations. Inline attachment blob data and extension-context payloads are omitted.

`tool.execution_start` retains `data.toolCallId`, `toolName`, and `arguments`.
`tool.execution_complete` retains the same exact `toolCallId`, `success`,
`result.content` as `output`, `result.detailedContent` as `detailedContent`,
`result.contents` as `contents`, `result.structuredContent` as `structuredContent`,
and any error object. Citable sources and both result-level (`resultMcpMeta`)
and event-level (`mcpMeta`) MCP metadata are independently retained.
`output` can be truncated by the CLI; native blocks and
verbatim MCP JSON can contain evidence absent from that summary. These optional
evidence fields are independently cloned, opaque JSON, preserving unfamiliar
block types and nested fields without an exhaustive SDK-specific validator.
A completion does not need its start in the same batch.
Consumers correlate by session, generation, optional agent ID, and tool-call ID;
they must not assume every start has already arrived.
`tool.user_requested` and `external_tool.requested` also produce tool starts,
with `eventType` distinguishing their origin. External requests retain request
ID, provider ID and working directory when supplied; MCP starts retain server
and tool names. `external_tool.completed` is a **request-correlated receipt**:
the SDK supplies only `requestId`, not success, tool-call ID, or output. These
values are never invented. Explicit transcript result/error extensions, when
actually supplied, remain opaque evidence in the receipt's `details`.

`diff` is source-reported evidence only. Explicit string `result.diff` or
`result.detailedContent.diff` is retained. String `detailedContent` is preserved
verbatim, even when it looks like a unified patch; no regex promotes UI text
to `diff`. Structured detail and extra warnings also remain intact.
TODO: map SDK structured patch fields when available instead of parsing UI text.
Script commands and output need no diff; no
filesystem changes are inferred, no Git diff is constructed, and neither
success nor a reported patch assigns work to a commit.

#### Story-relevant coverage policy

[`sessionEventPolicy.ts`](./src/sessionEventPolicy.ts) is the exhaustive,
field-level disposition registry: **131 SDK 1.0.13 types** plus the persisted
`skill.invoked_ref` and `skill.context_delivered_ref` types. A type-only SDK
contract fails the build when an SDK event is added without classification;
there is no production SDK runtime dependency. The 133 dispositions comprise
67 unconditional retains, 6 conditional operational outcomes, and 60
unconditional ignores. Classification does **not** mean every record is retained.
Selection is deterministic by event type and explicit outcome, never by text
heuristics or LLM interpretation.

| Category                                                                                                                                                                                                        | Disposition                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authoritative user/assistant/system messages, tool requests/completions, external request/receipt, MCP-app results                                                                                              | Normalize content, native correlations and selected opaque evidence.                                                                                                                                                                                                       |
| Skills and transcript-only skill references                                                                                                                                                                     | Preserve content or content ID/length and source/plugin/tool references, without resolving or inventing referenced content.                                                                                                                                                |
| Subagent start/configuration/selection/deselection/completion/failure                                                                                                                                           | Preserve meaningful configuration, lifecycle, and parent/tool/factory relationships.                                                                                                                                                                                       |
| Session start/resume/model/mode/context/title, warnings/errors, compaction/truncation/rewind, tasks/objectives/plans/workspace changes, schedules, handoff/shutdown/completion receipts                         | Preserve selected story state as `session` events with projected `details`; not whole raw payloads.                                                                                                                                                                        |
| System notifications, user input, elicitation, plan approval, command execution/receipt, auto-mode/limit interactions, factory start/settled, managed-settings enforcement                                      | Preserve questions/answers, notification content/kind and selected state/outcomes.                                                                                                                                                                                         |
| Model/fusion failures and final fusion outcome, MCP reconnect needed                                                                                                                                            | Preserve failure/outcome and correlation/model observations; omit intermediate fusion content.                                                                                                                                                                             |
| Hook end, permission completion, model call finished, MCP OAuth/header refresh/server status                                                                                                                    | **Conditional:** hook `success: false`; explicit cancelled/denied permission variants; model `error`/`cancelled`/`rejected`; OAuth `cancelled`; headers `none`/`timeout`; server `failed`/`needs-auth`. Preserve only selected failure fields; routine success is ignored. |
| Assistant usage                                                                                                                                                                                                 | Observe model only for cumulative metadata; omit accounting/latency/token details.                                                                                                                                                                                         |
| Streaming deltas, partial tool output/progress, assistant reasoning and intermediate fusion phases                                                                                                              | Ignore; authoritative completions are preferred. Private/encrypted reasoning fields on retained messages are also omitted.                                                                                                                                                 |
| Routine hooks/permissions, usage checkpoints/info, catalogs/tool searches, runtime/UI/canvas/extension bookkeeping, pending queues, task/schedule progress bookkeeping, sampling receipts, binary asset records | Ignore. Binary result copies for model input and UI resources are also omitted; native result blocks/structured evidence remain intact.                                                                                                                                    |

Disposition is explicit:

- Only genuinely unknown event types yield `unsupported-event`; they do not block usable
  records. This includes formats outside the CLI adapter.
- Missing/invalid supported content fields, non-object data, and malformed
  optional fields used by this adapter yield `malformed-event`. Timestamps,
  when supplied, must be parseable date-times with a timezone. The adapter
  validates the fields it uses, not every field in the upstream schema.
- Capture diagnostics are forwarded. Diagnostics contain only a code and
  capture source location, not payloads, arbitrary event types, or parser text.
  Invalid capture identity or mixed-generation envelopes throw an error.

Callers must surface all diagnostics rather than treating partial output as
complete. The latest valid source timestamp is observed even on ignored or
unsupported records. Normalized data is still private, **not privacy-approved**;
all messages, arguments, output, detail, native blocks, structured content,
diffs, errors, and metadata must pass
the separate privacy filter before publication.

### Cumulative metadata and recovery

`collectMetadata(request, normalizedBatch, previousState?)` returns
`SessionMetadataState` containing `sessionId`, `transcriptPath`, `generation`,
and `metadata`. Keep that state between batches and use `state.metadata` in
the `NormalizedSessionUpdate`. The registration's metadata is a seed, not a
replacement for restored history. It may include `parentSessionId`, `startedAt`,
and `lastEventTimestamp` in addition to `clientName` and `models`.
These optional fields also survive the daemon client's serialization and the
server's registration validation, including registrations with an explicit
absolute `transcriptPath`. Without one, the daemon retains the CLI client's
default location. VS Code hook transport preserves the same fields, but managed
VS Code registration returns 503 before capture because no native adapter exists.
Normalization expects the documented CLI event shapes. Parent IDs must be strings; timestamps must
be parseable date-times with a timezone, using the same validation as transcript
normalization. Invalid optional values are rejected, not silently discarded.

Collection unions seed/previous/observed models, including selected models on
start/resume, previous/new models on model changes, chosen/fallback/current
models, and final/follow-up fusion models. Explicit start/resume
`clientName` (or `producer`) and `parentSessionId` (or
`detachedFromSpawningParentSessionId`) supplement the seed. `startTime` or a
start event's timestamp establishes the earliest start; resuming never restarts
that clock. Latest event time is compared chronologically, not lexically.
Subagent lifecycle details do not change the containing session's parent.
Empty and metadata-only batches preserve cumulative metadata. Collection does
not mutate prior state or replay history on each incremental call.

State from another registration is rejected. A different capture generation
discards previous history and starts from the registration seed, so callers
must not put old-generation observations back into that seed.

Metadata is not saved inside the capture checkpoint or in a second state file.
After a restart, or whenever in-memory metadata might lag capture, use
`restoreMetadata(request, throughCheckpoint, generation, options?)`. Supply a
checkpoint and generation from an already captured batch; after automatic
resume, even an empty batch provides these. Restoration replays **from zero**
through that fixed boundary using the original transcript and durable capture
ID assignments, returning `{ state, nextCheckpoint, diagnostics }`. It returns
metadata only, not events for publication or delivery acknowledgement.

The boundary must belong to that session/transcript, be a complete-record
boundary, and not exceed the saved capture high-water. A dedicated read-only
replay holds process-local exclusion, loads the saved generation and ID map once,
and streams records through the requested boundary. It uses the same JSONL
reader and record decoder as capture, but missing generated-ID mappings fail
explicitly: replay never invents IDs or writes capture state.

Replay reads only through the requested boundary, once, then checks the open
file and path identity/size before returning accumulated metadata. Source I/O is
the requested prefix plus one boundary byte (zero bytes for a zero boundary),
independent of batch count or later captured history. A read chunk,
one possibly larger source record, and at most `maxRecords` decoded records are
buffered; the saved ID map and returned metadata/diagnostics still occupy memory
proportional to their sizes. There are no per-batch state writes or fsyncs.

Appends beyond the saved high-water are not read. Records beyond the requested
boundary are not normalized, and the saved read cursor is unchanged.
Observed replacement or truncation rejects restoration and discards
the private accumulation; file handles and exclusion are released on failure.
A zero boundary returns only registration seed metadata, while still verifying
the saved generation and source. As with capture, append-only history is a
precondition, not something checked by hashing or an operating-system snapshot.
`options.stateDirectory` selects the original capture state, and `maxRecords`
defaults to 1000. As with capture, serialize operations and retain both the
transcript and capture state. Diagnostics must be surfaced even when metadata
reconstruction succeeds. Restoration is an explicit recovery operation, not
incremental polling or downstream delivery acknowledgement.

For example, after capture has resumed:

```typescript
const captured = await watcher.captureUpdates(request, undefined, options);
// Surface captured.diagnostics, including any source-reset.
const restored = await watcher.restoreMetadata(
  request,
  captured.nextCheckpoint,
  captured.generation,
  options,
);
// Surface restored.diagnostics, then retain restored.state.
// Future batches use collectMetadata(request, normalizedBatch, state).
// Recovery of downstream event delivery is separate from metadata recovery.
```

### Privacy and approved-update handoff

`SessionWatcher` accepts optional `privacyFilter` and
`approvedUpdateDestination` constructor dependencies. No production filter or
destination is provided: filtering without a filter and publishing without a
destination fail explicitly. Managed watching, stopping, and `processUpdates`
are implemented; batch helpers remain available separately.

The filter receives a private snapshot of the **whole** `NormalizedSessionUpdate`:
project path, session ID, every event field (including messages, tool arguments,
results, and diffs), and session metadata. It returns an approved/redacted update
or `null` for deliberate exclusion, synchronously or asynchronously. The real
policy must inspect all outgoing fields and preserve valid references after
redaction; this connection does not implement that policy or validate its
decisions. Dependencies are trusted application code, not sandboxed plugins.
Updates and filter results must be data supported by Node's V8 serialization.
Functions and shared-memory buffers are rejected so snapshots cannot retain
mutable shared backing memory.

`filterForPrivacy` returns an opaque `ApprovedSessionUpdate` handle, or `null`.
The handle contains no payload. A private per-watcher registry checks its identity
at runtime; a TypeScript cast, copied handle, or another watcher's approval cannot
authorize delivery. `publishUpdate` accepts only a handle from that watcher:

```typescript
const watcher = new SessionWatcher({
  privacyFilter,
  approvedUpdateDestination,
});
const approved = await watcher.filterForPrivacy(update);
if (approved !== null) {
  await watcher.publishUpdate(approved);
}
```

The watcher snapshots the input before invoking the filter, snapshots the
approved result before returning its handle, and gives the destination a fresh
copy on each call. Mutating the caller's input, a retained filter result, or a
previous delivery cannot change the stored approval. Handles are process-local,
reusable for explicit retries, and retained only while referenced; there is no
automatic retry, durable queue, or deduplication here. The destination must use
the approved session/event identities for any idempotency it requires, including
metadata-only updates.

The destination accepts a `NormalizedSessionUpdate` containing **only** the
approved snapshot and returns `void` or `Promise<void>`. It resolves when the
handoff is accepted, not when Neumem extraction or story building finishes.
Delivery never changes or acknowledges the source-read checkpoint. Filter,
snapshot, and destination failures surface as fixed stage-specific errors
without raw payloads or dependency error causes; this boundary logs nothing.
Injected dependencies must follow the same no-sensitive-logging requirement.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
