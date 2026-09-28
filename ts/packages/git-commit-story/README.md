# git-commit-story

Attaches the agent sessions that led to a commit to that commit. This package is
the scaffold: a CLI with no story logic yet.

Git runs any `git-<name>` binary on `PATH` as `git <name>`, so the
`git-commit-story` binary is also `git commit-story`.

```text
$ cd ts/packages/git-commit-story
$ pnpm build
$ npm link            # puts git-commit-story on PATH
$ git commit-story hello
Hello from git-commit-story
```
