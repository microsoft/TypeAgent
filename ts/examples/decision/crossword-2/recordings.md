# Crossword 2 Recordings

Recorded October 14, 2026. See [implementation and research](./README.md) for
the reference review, MIT license, pinned renderer, original clues, and
Exolve-specific adapter boundary. The 15x15 grid has 158 playable cells and 36
clues; no solution letters are served.

## Live Outcomes

Requested model: `gpt-6-luna-decisions`, via the existing Copilot client with an
explicit standalone CLI path. Answers were supplied by scenario code, not
generated. The model selected clue references only. Fit threshold stayed 0.8.

| Scenario | Verified outcome                                             | Decision calls | Presentation duration |
| -------- | ------------------------------------------------------------ | -------------- | --------------------- |
| read     | Current 1 across and 1 down text returned                    | 2              | 9.32 s                |
| fill     | Supplied LASER entered across and read back                  | 1              | 11.12 s               |
| crossing | LASER across, LATER down; shared L and other cells preserved | 2              | 17.72 s               |
| conflict | Supplied WATER rejected before entry; LASER unchanged        | 2              | 12.76 s               |

All four passed, with seven live decision calls and zero model calls during
execution. Demo pacing is enabled; these are **not benchmark measurements**.
An earlier CLI-wrapper transport failure is retained separately, without
decision evidence or an inferred call count. The standalone CLI retry succeeded.

## Artifacts

```text
%USERPROFILE%/OneDrive - Microsoft/Videos/web-videos/crossword-2-2026-10-14T09-35-18-399Z/
```

Each scenario directory has original `scenario.webm`, raw video, case screenshots,
and source-hashed `evidence.json`. Batch scope is in `manifest.json`; independent
media checks are in `media-acceptance.json`. Edited copies under
`presentation/<scenario>/demo.webm` trim only two startup seconds. Original run
evidence is unchanged. The initial blocked attempt is retained under
`crossword-2-2026-10-14T09-24-35-450Z` with `blocked-attempt.json`.

Trusted, ignored review copy:

```text
.scratch/crossword-2-2026-10-14T09-35-18-399Z-review/
```

It contains `index.html`, `frames.html`, `frame-sheet.png`, presentation videos,
first/middle/final PNG frames, evidence, and acceptance metadata. Trusted videos
match the OneDrive copies by SHA256. Recorded source hashes match the finalized
implementation.

All four raw and presentation videos fully decoded: silent VP8 WebM, 1100x800,
finite duration. Installed Edge playback and seeking passed for each. Decoded
first/action/final frames were reviewed for puzzle, clues, letters, and readable
captions without overlap. The earlier integrated-browser WebM demuxer limitation
remains explicit; decoded frames provide reliable inline review. No MP4
conversion, new codec installation, upload, or shared browser-tab capture.

## Validation

Affected example build and all 106 local tests pass. Focused tests cover grid
integrity, the exact two actions, both directions, crossing guards, answer length,
missing clues, stale targets, and 1100px desktop/390px mobile layouts. Actual
Playwright screenshots on both viewports were reviewed. New files have zero lint
findings and no functions above CC25/Cog30. Pinned formatting, circular ratchet,
and test-debt gate pass.

Whole-branch lint and complexity still report the earlier five console findings
in the original API runner and three over-budget functions in MCP, workflow,
and dispatcher experiments. No unrelated refactor or legacy evidence replacement.
