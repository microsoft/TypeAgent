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
`captureSessionUpdates` in `src/sessionCapture.ts`. Capture is implemented;
watch/stop, processing, normalization, privacy filtering, and delivery remain
separate work. Nothing starts a watcher, daemon, hook, or VS Code adapter.

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

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
