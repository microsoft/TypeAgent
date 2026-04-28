# 07 - CLI

Status: **Stub** - design pending.
Owner: TBD.
Depends on: 01 (per command).

Maps to PLAN: [Track E](./PLAN.md#track-e---cli-parallel-after-0c-ships-alongside-core).
The CLI is the cheapest smoke-test for each core service; commands ship
as the corresponding A.\* / B.\* item lands rather than as a single
batch.

> Directory: `examples/grammarStudio` (if a new package) or extend
> `examples/schemaStudio`. Package name (if new): `grammar-studio`.

## TL;DR

Lightweight `interactive-app` REPL for headless grammar exercises.
Serves three roles:

1. **Smoke-test harness** for `grammar-tools-core` during Phase 1
   (each command exercises one core service).
2. **CI tool** for grammar coverage / regression checks.
3. **Developer tool** for ad-hoc grammar exploration.

## Scope

Commands (each corresponds to one PLAN Track E item; deps in italics):

- **E.0** Scaffold the package (REPL, command dispatcher, output
  formatting).
- **E.1** `grammar load <path-or-agent>` - select active grammar.
  _Needs A.1._
- **E.2** `grammar match <input>` - run completion preview, print
  results. _Needs B.1._
- **E.3** `grammar trace <input>` - print rule-level trace as a text
  table. _Needs B.2._
- **E.4** `grammar coverage <corpus.txt>` - per-rule hit counts.
  _Needs B.3._
- **E.5** `grammar diff <a> <b>` - structural diff. _Needs B.4._

## Non-scope

- UI / visualization (text output only).
- Replacing
  [`packages/actionGrammarCompiler`](../../../packages/actionGrammarCompiler)
  CLI - that stays the canonical compile / format entry point.

## Open questions

- New package vs extending `schemaStudio`? Extending keeps one tool;
  new package keeps grammar concerns separate.
- Output format - human only, or `--json` mode for scripts?

## Verification

- `pnpm --filter grammar-studio start` opens the REPL.
- `grammar match "play "` against the player grammar matches
  Jest expectations.
