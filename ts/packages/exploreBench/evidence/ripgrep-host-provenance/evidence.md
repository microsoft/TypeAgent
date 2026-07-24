# TypeAgent ripgrep host-provenance verification

## Goal and final resource

Verify the built TypeAgent Explorer `repo.grep` runtime uses the same
Copilot-packaged ripgrep executable as the benchmark baseline, while keeping
execution provenance outside model-controlled tool input.

Final resource: `explorer-typeagent`'s built `createRepositoryTools` API and
the ExploreBench telemetry/integrity boundary.

Environment: macOS arm64, Node 24, pnpm 10.34.4. No provider credentials,
network requests, Docker operations, or paid model calls were used.

## Test-first regression

The forged missing-path probe failed before the implementation changed:

```text
$ node --test --test-name-pattern='requires exact usage and repository-tool evidence' dist/test/integrity.spec.js
✖ requires exact usage and repository-tool evidence
AssertionError [ERR_ASSERTION]: Missing expected exception: pre-execution grep probe forges legacy ripgrep input fields
tests 1
pass 0
fail 1
```

## Built runtime proof

Working directory: `ts/packages/agents/explorer`.

The non-interactive Node invocation imported the built Explorer API, resolved
the Copilot-packaged ripgrep executable, submitted one forged pre-execution
probe followed by one real content search, and asserted both trace shapes.
The command exited 0 and printed:

```json
{
  "packagedExecutable": "rg",
  "missingProbe": {
    "tool": "grep",
    "durationMs": 0,
    "input": {
      "pattern": "needle",
      "path": "missing"
    },
    "resultCount": 0,
    "outputBytes": 2,
    "truncated": false
  },
  "executedSearch": {
    "tool": "grep",
    "durationMs": 58,
    "input": {
      "pattern": "keeps ripgrep execution evidence separate",
      "path": "test",
      "literal": true,
      "maxMatches": 1
    },
    "execution": {
      "engine": "ripgrep",
      "executable": "rg"
    },
    "resultCount": 1,
    "outputBytes": 144,
    "truncated": true
  },
  "match": {
    "path": "test/repositoryApi.spec.ts",
    "line": 385,
    "text": "    it(\"keeps ripgrep execution evidence separate from model input\", async () => {"
  }
}
```

Timestamps were omitted from this retained excerpt; the runtime output included
them and no local absolute paths or credentials.

## Package gates

```text
$ corepack pnpm --filter explorer-typeagent run build
exit 0

$ corepack pnpm --filter explorer-typeagent test
Test Suites: 5 passed, 5 total
Tests:       73 passed, 73 total
exit 0

$ corepack pnpm --filter @typeagent/explore-bench test
tests 131
pass 131
fail 0
exit 0

$ ./node_modules/.bin/prettier --check <12 changed source/test/doc files>
Checking formatting...
All matched files use Prettier code style!
exit 0
```

## Result

Pass. Valid TypeAgent grep searches execute the injected Copilot-packaged `rg`.
Model-supplied legacy `engine` and `ripgrepPath` properties are neither retained
as trace input nor accepted as execution proof. Recoverable pre-execution probes
remain valid only when the same successful benchmark row contains a separate
host-proven ripgrep execution.
