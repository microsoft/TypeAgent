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

## Draft story contracts

These interfaces are proposals only. They do not implement extraction, watching,
commit-message rendering, or hook/API integration.

- `src/gitCommitStory.ts` defines `GitCommitStory<TMemory>` and its session,
  summary, memory, and metadata objects. Each human-readable summary entry links
  to memories in the same session through `memoryIds`. Memory IDs must be unique
  within that session, and every reference must resolve. `TMemory` leaves the
  extraction payload open without imposing decision or activity categories.
- `src/sessionWatcher.ts` defines `SessionWatcher`. `watch` registers a local
  session transcript; `stop` releases the watcher's background resources.
  Retrieving session stories and mapping them to commits are outside this
  interface. A future memory-client contract may provide those operations.
- `src/storyBuilder.ts` defines `StoryBuilder<TMemory>`. `build` accepts the
  candidate commit and its session stories, authors the title and description,
  and returns both the structured story and the complete transformed commit
  message. It does not create or amend a Git commit.

`CommitContext` carries an absolute project path, the exact candidate diff, and
the original message (which may be empty) for the builder. A session's transcript
path is local watcher input, not
part of the portable story. Optional summary timestamps use RFC 3339 strings.
Model names describe the session's observed models, not the story-authoring model.

The watcher monitors sessions; the builder receives session stories from its
caller. The retrieval contract between those stages is deferred. Multiple
sessions can contribute to a commit, and one session can contribute different
content to multiple commits. Subagent work remains part of its parent session's
memories. Asynchronous failures reject rather than silently returning an empty
story. Repeated registration, in-flight processing at commit time, and the
serialized message format remain design decisions. These contracts do not claim
complete or tamper-proof capture.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
