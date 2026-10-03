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

### Privacy and approved-update handoff

`SessionWatcher` accepts optional `privacyFilter` and
`approvedUpdateDestination` constructor dependencies. No production filter or
destination is provided: filtering without a filter and publishing without a
destination fail explicitly. Watching, capture, normalization, metadata
collection, and `processUpdates` remain unimplemented in this scaffold.

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
