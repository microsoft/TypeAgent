# git-story

Attaches the agent sessions that led to a commit to that commit. Private session
events stay in `.git/story/`; commits carry a filtered `~~~story v2` JSON block
and `Story-Session` trailers.

Git runs any `git-<name>` binary on `PATH` as `git <name>`, so the
`git-story` binary is also `git story`.

```text
$ cd ts/packages/git-story
$ pnpm build
$ npm link            # puts git-story on PATH
$ git story init   # registers Copilot CLI and Git hooks for this repo
$ copilot -p "Create hello.txt containing hello" --allow-all-tools
$ git add hello.txt && git commit -m "Add hello"
$ git story show HEAD
```

`init` registers prompt, session, tool, and stop hooks in
`.github/copilot/settings.local.json`. It adds that file to
`.git/info/exclude`, so the settings stay local to the clone.

`init` also writes `pre-commit`, `prepare-commit-msg`, and `post-commit` scripts
to the Git hooks directory, honoring `core.hooksPath`. It does not overwrite a
hook that it did not write. Story capture is observational: hook failures do not
block commits.

`prepare-commit-msg` links pending session writes to staged blobs and adds the
filtered v2 story. `post-commit` advances the linked session checkpoints.
Stories are capped at 16 KiB; snippets and ordinary run commands are removed
before elevated-risk commands.

## Memory

`git story memory sync` indexes commit stories under `.git/story/memory/`.
`git story ask "<question>"` answers from that memory. Sync skips commits it has
already indexed and does not extract knowledge.

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

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
