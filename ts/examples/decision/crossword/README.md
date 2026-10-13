# On-demand crossword grounding (Experiment 7)

The public action surface is exactly:

```javascript
const actions = createCrosswordActions({ executor, page, client });
await actions.getClueValue(1, "across");
await actions.enterText("cat", 1, "across");
```

Both actions make a fresh observation asking which visible element contains
clue N across/down. The same thin external observer from `../web-shopping` issues
IDs and owns selectors. The decision returns only an ID/no-fit plus fit; the
host verifies the ID against the requested number/direction and current DOM
before execution. `getClueValue` reads live innerText, never a cached clue schema.

`enterText` clicks the selected clue through the bounded Playwright executor and
types the supplied answer with `page.keyboard.type`. It verifies intended
grid/direction focus before every character, reads back the cells, rejects
conflicting existing crossing letters, and confirms non-target cells are
unchanged. It reports supplied text, explicit uppercase normalization, and
readback. Only ASCII letters are supported; punctuation, wrong lengths,
unsupported grid mappings, and missing/ambiguous/stale/wrong targets fail closed.

The original 3 x 3 fixture uses ordinary inputs and clue buttons. Its DOM
annotations supply only the selected clue's cell mapping. There is no full
puzzle schema extraction, answer generation, Exolve prerequisite, publisher
automation, or hidden generative fallback. Canvas/no eligible clues abstain
without model calls. Only the owned localhost fixture is supported.

## Commands

From the repository root in PowerShell:

```powershell
if (Test-Path $PROFILE) { . $PROFILE }
node ts/examples/decision/crossword/run.mjs --dry-run
node ts/examples/decision/crossword/run.mjs
node --test --test-concurrency=1 ts/examples/decision/crossword/crossword.spec.mjs ts/examples/decision/crossword/browser.spec.mjs
$cli = Get-Command copilot -CommandType Application | Select-Object -Last 1 -ExpandProperty Source
node ts/examples/decision/crossword/run.mjs --live --limit 2 --cli-path $cli
```

Defaults are offline with a named fixture selector, not a hidden fallback.
`--live`, `--limit 1|2`, `--cli-path`, and `--model` have the same meaning as the
shopping runner. Native/rerank variants are rejected for this lane. See the
shopping README for pinned formatting and combined validation commands.

## Current Migration Validation

Four contract and seven browser tests pass in the 66-test combined suite (zero
failures/skips). Final validation uses normal Playwright 1.57.0 dependency
resolution after a frozen offline install with scripts disabled. The package
build passes; no provider script approvals were added.
`offline-evidence.json` was regenerated: clue read and supplied `cat` fill passed,
`CAT` readback and crossings verified, zero decision model calls. Desktop/mobile
screenshots were regenerated directly from Playwright and visually inspected.

## Historical Evidence (PRE-REMOVAL, 2026-10-13)

`live-evidence.json` is unchanged PRE-REMOVAL Stagehand evidence, not a current
Playwright live result. No live calls were made during migration. Any retained
JSON with `stagehand: "3.0.0"`, including the original offline report, is also
PRE-REMOVAL evidence. Regenerated reports identify `automation: "playwright"`
and structural `explicitActModelCalls: 0`, without SDK counters or metrics.

1. Exactly two public actions, shared on-demand observer, no extraction phase.
2. The historical four contract tests and seven browser tests passed: live clue reads,
   both directions, supplied-answer/crossing readback, missing/duplicate/canvas
   clues, stale refs/reobservation, wrong/no-fit choices, crossing conflicts,
   wrong focus, and responsive screenshots.
3. The original offline report recorded passing get/fill; it has now been
   regenerated as current Playwright evidence, with no model calls.
4. `live-evidence.json` records **two** serial real Copilot decision calls:
   `getClueValue(1, across)` returned `1. A feline pet`; `enterText(cat, 1,
across)` read back `CAT` with crossings intact. Both choice and fit
   probabilities were 1.0. Response model was `gpt-6-luna` for requested
   `gpt-6-luna-decisions`. Stagehand explicit execution counted **zero**
   generative calls and zero inference tokens, without generative credentials.
5. Owned, visually inspected `desktop.png` (1100 x 800) and `mobile.png`
   (390 x 844) show the grid/clues; Playwright assertions check render presence,
   cell count, and no horizontal overflow.

Observed get/fill elapsed times were approximately 12,695 ms and 468 ms in this
single smoke. They include provider startup and keyboard delays, and establish
neither cold/warm benchmarks nor speedup claims. No further live calls were made.

## Boundaries

Stagehand and its multi-provider dependency fanout have been removed. The launcher
directly imports the existing Playwright 1.57.0 dependency and uses an isolated
temporary persistent context. Native/rerank
are unavailable, including dry-run. Copilot/TypeAgent chat and responses support
exists, but a native baseline requires a custom client implementation, not new
provider secrets. Browser tests regenerate screenshots directly from Playwright.
Grid focus/cell readback here intentionally depend on
the owned fixture's DOM annotations, not an asserted general crossword engine
adapter. Cross-origin frames, shadow roots, and unannotated grids are unsupported
and must not be dispatched against. Parent consolidation owns full repository
gates; this lane changed no shared decision client, main entry, or production
browser code.
