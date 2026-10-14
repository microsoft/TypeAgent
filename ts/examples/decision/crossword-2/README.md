# Crossword 2

[Recorded scenarios and validation](./recordings.md).

A realistic, locally hosted 15x15 crossword rendered by **Exolve**, rather than
our original annotated 3x3 mock. It has 158 playable cells, 36 numbered clues,
black squares, across/down crossings, clue highlighting, keyboard navigation,
clear controls, and local saved state. The grid is adapted from Exolve's
MIT-licensed `test-columnar.html`; the placeholder clues are replaced with
original definitions. The served puzzle contains **no solution letters**.

## Setup And Play

From this example's parent directory:

```powershell
node crossword-2/fixture.mjs --setup
node crossword-2/fixture.mjs
```

Setup downloads only Exolve JavaScript, CSS, and its license from immutable
commit `a686b7936bdec1da9199da78b62681853b325e83`. SHA256 verification is mandatory
both at download and serve time. Files live in ignored `node_modules/.cache/`,
not a new dependency graph. Once cached, playing, testing, and recording require
no renderer network access. The server prints its loopback URL. Stop it with
Ctrl+C. Missing assets produce a setup error, not a silent download.

## Actions And Scenarios

Exactly two public actions: `getClueValue(number, direction)` and
`enterText(value, number, direction)`. `direction` is `across` or `down`.
The adapter observes native Exolve clue rows, issues ephemeral host references,
and asks the existing bounded decision selector to choose a clue. Number,
direction, visible text, and entry length are the evidence. The model neither
generates selectors nor answers. Supplied answers are explicitly uppercased;
punctuation and mismatched lengths are rejected.

The host verifies the binding before interaction, clicks the native row, presses
Home, checks the renderer's focused input and cell before every letter, and reads
the **rendered SVG text nodes** afterward. Existing incompatible letters are
rejected before clicking; cells outside the entry must remain unchanged. No
whole-puzzle solution extraction, answer generation, or direct grid writes.

```powershell
node crossword-2/run.mjs --scenario read --dry-run
node crossword-2/run.mjs --scenario crossing
node crossword-2/run.mjs --scenario crossing --live --record-dir '<fresh-directory>' --demo
node --test crossword-2/crossword.spec.mjs
```

`read` reads 1 across and 1 down. `fill` enters supplied LASER in 1 across.
`crossing` then enters supplied LATER in 1 down, preserving their shared L.
`conflict` attempts supplied WATER in 1 down after LASER and requires rejection.
Each scenario makes at most two selector calls. `--live` uses the existing
Copilot decision client; otherwise the explicitly labeled offline selector is
deterministic. Demo pacing is not benchmark timing. Videos and evidence use the
existing isolated Playwright recording lifecycle. Raw media is not considered
validated until independently decoded and reviewed.

## Research And Boundaries

Reviewed the previous standalone `typeagentNanoTests` crossword side panel,
`sidepanel.js`, and `pageExecute.js`. Its cached `getClueValue` lookup and injected
pointer/keyboard dispatch informed the two-action boundary. This version uses
Playwright's normal input dispatch and adds fresh bindings and readback checks.
It does **not** port the browser-local model extraction or command translator.

Reviewed the supplied [Crossword Labs example](https://crosswordlabs.com/view/back-to-school-119)
and [Crossworthy example](https://www.crossworthy.net/play/p-x102pr2yghhf6).
Both demonstrate realistic clue/grid layouts, but publicly playable content does
not establish permission to redistribute it. Their markup and puzzles were not
copied, and no live-site writes were performed.

[Exolve](https://github.com/viresh-ratnakar/exolve) provides an MIT-licensed
renderer with native clue-to-cell mappings, SVG text, interactive input, and
responsive layouts. The immutable source and [license](./THIRD_PARTY_LICENSE.md)
are retained. This adapter is **Exolve-specific**, not a general site adapter for
Crossword Labs, Crossworthy, canvas puzzles, rebuses, linked clues, cross-origin
frames, or shadow DOM. It deliberately rejects missing or ambiguous engine
instances and unsupported mappings. Legacy crossword code and evidence remain
unchanged.
