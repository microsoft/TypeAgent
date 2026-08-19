# TypeAgent Coding Smoke Test

This package is a deterministic manual test target for TypeAgent's automatic
Copilot coding workflow. It compiles successfully but starts with four failing
behavioral tests in `src/releaseNotes.test.ts`.

## Baseline

From this directory:

```powershell
pnpm test
```

Expected baseline: one passing test and four failing tests covering kind
normalization, ID deduplication, numeric sorting, and Markdown escaping.

## Suggested Conversation

Start TypeAgent from this directory so the CLI proposes it as the coding working
directory:

```powershell
node ..\..\packages\cli\bin\run.js
```

Alternatively, configure agent-server's coding root as shown below. Send the
prompts as ordinary requests; no mode command is needed.

For a local shell connected to a local agent-server, an absolute file path in a
prompt selects that file's parent directory automatically. You can also send:

`Use C:\Users\me\Downloads\codingSmokeTest as my coding working directory`

No environment variables are required when the agent-server allowlist is
unset; any existing local directory is selectable.

1. `Explain how src/releaseNotes.ts transforms changes into Markdown. Identify the likely causes of the failing tests, but do not modify files.`

   Expected: coding analysis, no writes, and no validation requirement.

2. `Fix all failing tests in this codingSmokeTest package. Keep the public API stable and run pnpm test.`

   Expected: edits `src/releaseNotes.ts`, runs the tests, and reports successful
   validation.

3. `Now add support for a breaking change kind. Breaking changes should appear before features, fixes, docs, and other changes within each section. Add tests and run them.`

   Expected: same coding session resumes, source and tests change, validation
   runs again.

4. `Look up the current Node.js test runner documentation for subtests. Refactor one test to use a subtest where it improves clarity, then run pnpm test.`

   Expected: web research remains owned by the coding agent, followed by a test
   edit and validation.

5. `Create DESIGN.md describing the release-note data flow, sorting rules, and extension points.`

   Expected: Markdown creation without an unnecessary build/test continuation.

6. `What is the weather in Seattle?`

   Expected: normal TypeAgent routing; coding affinity is released.

7. `Review src/releaseNotes.ts for edge cases introduced by the breaking-change feature.`

   Expected: coding resumes for this working directory using the persisted SDK
   session.

## Agent-Server Setup

On the machine running agent-server:

```powershell
$env:TYPEAGENT_CODE_ALLOWED_ROOTS='D:\repos\TypeAgent\ts\examples'
$env:TYPEAGENT_CODE_DEFAULT_WORKING_DIRECTORY='D:\repos\TypeAgent\ts\examples\codingSmokeTest'
```

The paths must exist on the agent-server machine. A remote client's local path
is only a proposal and is ignored when it does not resolve under the configured
server roots.

## Reset the Scenario

From the TypeAgent `ts` directory:

```powershell
git restore -- examples/codingSmokeTest
Remove-Item examples\codingSmokeTest\DESIGN.md -ErrorAction SilentlyContinue
```

Run `pnpm --filter coding-smoke-test test` to confirm the baseline is back to
four failures and one pass.
