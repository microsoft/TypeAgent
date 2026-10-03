# git-story

Attaches the agent sessions that led to a commit to that commit. This package is
the scaffold: a CLI with no story logic yet.

Git runs any `git-<name>` binary on `PATH` as `git <name>`, so the
`git-story` binary is also `git story`.

```text
$ cd ts/packages/git-story
$ pnpm build
$ npm link            # puts git-story on PATH
$ git story init   # registers Copilot CLI and git hooks for this repo
$ git story hooks copilot user-prompt-submitted
Hello World
$ echo input | git story hooks git pre-commit a b
git-story pre-commit: args=["a","b"] stdin="input\n"
```

`init` writes the hooks to `.github/copilot/settings.local.json` and adds that
file to `.git/info/exclude`, so it stays local to the clone.

`init` also writes a `pre-commit` script to the git hooks directory (honors
`core.hooksPath`). The script runs `exec git-story hooks git pre-commit "$@"`,
so git's hook arguments and stdin reach the command unchanged. `init` does not
overwrite a hook that it did not write.

## Daemon

`git story daemon start|stop|restart|status` manages one HTTP API server per
user, shared by all projects. It binds `127.0.0.1:51703` and keeps
its pid and port in `~/.typeagent/git-story/daemon.json`, log in
`~/.typeagent/git-story/daemon.log` (`~` is the user home directory on macOS and
Windows).

Each request names its project by absolute path in the `project` query
parameter:

```text
$ git story daemon start
Started (pid 70006) at http://127.0.0.1:51703
$ curl -G http://127.0.0.1:51703/api/story/commits/79f77a3 --data-urlencode project=/Users/me/repo
{"hash":"79f77a337c682a14ec7df45d309c4856cf3bf236","subject":"hello story"}
```

Routes are in `src/server/router.ts`; handlers are in `src/server/routes/`.

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
and metadata collection/restoration are implemented. Watch/stop, processing,
privacy filtering, and delivery remain separate work. Nothing starts a watcher,
daemon, hook, or VS Code adapter.

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
read progress, not downstream ingestion acknowledgement. Delivery recovery must
explicitly replay: pass a zero checkpoint to reread the current generation, or
pass a previously read nonzero checkpoint together with
`options.expectedGeneration` from its batch. A checkpoint alone has no generation
and cannot safely authenticate a nonzero replay cursor. Replay does not regress
the saved high-water checkpoint. Keep the original transcript and capture state
for as long as replay is needed; deleting state loses generated-ID assignments.

File identity, observed length, and a SHA-256 digest of the consumed prefix
detect replacement, truncation, and rewritten/regrown content. Hashes identify
source changes, **not event IDs**. Automatic resume starts at zero with a new
generation and a `source-reset` diagnostic when the source changed. An explicitly
generation-bound replay fails instead. The reader seeks to the requested byte
offset but also rereads the consumed prefix to verify its digest; this deliberate
I/O cost detects in-place changes that file identity and length alone miss.
Observed changes during capture reject the batch without saving progress.
An identical in-place truncate-and-regrow completed between captures is not
distinguishable from the original file if both its identity and bytes are
unchanged.

State is private local capture data, not privacy-approved output; do not log or
publish raw envelopes. Files use exclusive creation and restrictive modes where
supported, then flush and rename a same-directory temporary file over the prior
state. Write/flush/rename failures reject capture and leave the previous state
intact. This is atomic file publication, not a cross-platform power-loss durability
guarantee. A per-state exclusive `.lock` rejects concurrent writers. Serialize
captures; after a writer crashes, remove its abandoned `.lock` only after
confirming it has stopped. Corrupt or unreadable state fails closed rather than
silently discarding identity assignments.

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
`agentId` are retained. Session identity belongs to the enclosing update.

`tool.execution_start` retains `data.toolCallId`, `toolName`, and `arguments`.
`tool.execution_complete` retains the same exact `toolCallId`, `success`,
`result.content` as `output`, `result.detailedContent` as `detailedContent`,
and any error object. A completion does not need its start in the same batch.
Consumers correlate by session, generation, optional agent ID, and tool-call ID;
they must not assume every start has already arrived.

`diff` is source-reported evidence only. Explicit string `result.diff` or
`result.detailedContent.diff` is retained. A literal unified diff in
`detailedContent` is also recognized when it begins with `diff --git` or `---`
and contains adjacent `---`/`+++` file headers and a numbered `@@` hunk header.
The original detail is always retained, including structured detail, extra
warnings, or text that does not match this supported diff shape. Arbitrary UI
text is not labeled a diff. Script commands and output need no diff; no
filesystem changes are inferred, no Git diff is constructed, and neither
success nor a reported patch assigns work to a commit.

Session events retain their data as `details`: `session.start`, `resume`,
`model_change`, `info`, `warning`, `error`, `idle`, `shutdown`, `context_changed`,
`title_changed`, `task_complete`, `handoff`, `truncation`, and
`compaction_complete`. `assistant.usage` and `subagent.started`, `completed`,
and `failed` are also retained as session events. Unconsumed session details
are preserved without interpreting user intent.

Disposition is explicit:

- Streaming/progress records are ignored: `assistant.message_delta`,
  `message_start`, `reasoning_delta`, `streaming_delta`, `tool_call_delta`,
  `turn_start`, `turn_end`, `idle`, and `tool.execution_partial_result`/
  `execution_progress`. These are not authoritative completed content.
- Other event types yield `unsupported-event`; they do not block usable
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
all messages, arguments, output, detail, diffs, errors, and metadata must pass
the separate privacy filter before publication.

### Cumulative metadata and recovery

`collectMetadata(request, normalizedBatch, previousState?)` returns
`SessionMetadataState` containing `sessionId`, `transcriptPath`, `generation`,
and `metadata`. Keep that state between batches and use `state.metadata` in
the `NormalizedSessionUpdate`. The registration's metadata is a seed, not a
replacement for restored history. It may include `parentSessionId`, `startedAt`,
and `lastEventTimestamp` in addition to `clientName` and `models`.

Collection unions seed/previous/observed models, including selected models on
start/resume and previous/new models on model changes. Explicit start/resume
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
boundary, and not exceed the saved capture high-water. A prefix pass verifies
the saved generation's identity and digest while counting source records
(including malformed ones) only through the chosen boundary. Capture then replays in
batches limited to that count. Appends during restoration remain unread beyond
the chosen boundary, and replay never moves the saved cursor backwards.
Each nonempty replay batch revalidates the generation; replacement, truncation,
or rewriting between counting and replay rejects restoration. A zero boundary
returns only registration seed metadata and consumes no records.
`options.stateDirectory` selects the original capture state, and `maxRecords`
defaults to 1000. As with capture, serialize operations and retain both the
transcript and capture state. Diagnostics must be surfaced even when metadata
reconstruction succeeds. Capture's prefix verification still runs per replay
batch; restoration is an explicit recovery operation, not incremental polling.

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

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
