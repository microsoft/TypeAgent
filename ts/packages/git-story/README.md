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
$ echo '{"sessionId":"s1","timestamp":0,"cwd":".","prompt":"hi"}' | git story hooks copilot user-prompt-submitted
git-story userPromptSubmitted: session=s1
{}
$ echo input | git story hooks git pre-commit a b
git-story pre-commit: args=["a","b"] stdin="input\n"
```

`init` registers the `userPromptSubmitted`, `sessionStart`, and `agentStop`
Copilot hooks in `.github/copilot/settings.local.json` and adds that
file to `.git/info/exclude`, so it stays local to the clone.

`init` also writes `pre-commit`, `prepare-commit-msg`, `post-commit`,
`post-merge`, and `post-rewrite` scripts to the git hooks directory (honors
`core.hooksPath`). Each script runs
`exec git-story hooks git <hook> "$@"`,
so git's hook arguments and stdin reach the command unchanged. `init` does not
overwrite a hook that it did not write.

`prepare-commit-msg` appends a `typeagent` line to the commit message, once.
This is a placeholder for the git-story summary.

`post-commit` requests aggregation at the new `HEAD`. Git has no `post-pull`
hook, so `post-merge` handles pulls that merge or fast-forward and
`post-rewrite` handles pulls that rebase. Aggregation failures are logged and
do not change the result of the completed git operation.

## Story Aggregator

The Session Watcher and Story Aggregator operate on different data. The watcher
captures private session evidence, normalizes it, and sends privacy-approved
updates to a configured destination. A Story Builder can use that evidence to
produce a portable `GitCommitStory`. The aggregator reads only published stories
from Git commit messages and submits those stories to searchable memory.

Aggregation resolves a fixed revision, classifies commits with missing,
malformed, or unsupported stories separately, and reports destination acceptance
separately from completed indexing. It must also reconcile rewritten history so
stories from commits that are no longer reachable do not remain searchable.

The current post-git hooks call the aggregator scaffold directly. Before history
scanning is implemented, aggregation admission should move behind the daemon so
the hooks can submit a bounded asynchronous request instead of scanning Git
history during `git commit` or `git pull`.

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
