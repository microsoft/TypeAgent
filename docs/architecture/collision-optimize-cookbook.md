# `@collision optimize` cookbook

End-to-end walkthrough, smallest smoke to fullest sweep. All dispatcher
commands run inside the dispatcher shell; `node …` commands run from
`ts/`.

---

## 0. Prerequisites (one-time)

```bash
cd ts/
pnpm --filter agent-dispatcher build
pnpm --filter default-agent-provider build   # for the out-of-process runner
```

LLM credentials in `ts/.env` (Azure OpenAI or OpenAI). The optimize loop
uses the same translator credential `@collision corpus translate` already
uses.

Pick a `--workdir` and use it consistently across every step — every
artifact lives there. The cookbook uses `D:\collisions` as the example.

---

## 1. Generate the corpus + baseline translation (upstream)

The optimize loop consumes a baseline translator-probe file produced by
the corpus subcommands. Two LLM-heavy steps:

### 1a. Generate the phrase corpus

```
@collision corpus generate --workdir D:\collisions
```

Walks every registered agent action, asks the LLM to produce natural-
language phrases that should route to each action, writes `corpus.json`.
LLM-heavy — minutes of LLM calls. The default uses one model (configured
in your `.env`); use `--models gpt-4o,gpt-4.1-mini` to multi-source the
corpus and `--styles imperative,casual,typos` to vary phrase style.

### 1b. Translate the corpus (baseline)

```
@collision corpus translate --workdir D:\collisions
```

Runs every phrase through the live translator, records what
`(schemaName, actionName)` the LLM picked. Writes
`translation-results.json` — the **baseline** that every subsequent
optimize step diffs against. LLM-heavy again; one call per phrase.

Optional: bound the cost on a first try with `--max-phrases 200` to
sample a subset.

After 1a + 1b you should have these two files:

```
D:\collisions\
├── corpus.json
└── translation-results.json
```

If you've already run these in a prior session, skip step 1 entirely —
the files are durable.

---

## 2. Verify the optimize surface is wired (no LLM cost)

```
@collision optimize list-levers
```

Expect 4 rows: `fewshot`, `jsdoc`, `manifest`, `prune`. If you see
fewer, the build didn't pick up the lever registrations — re-run
`pnpm --filter agent-dispatcher build`.

---

## 3. Build neighborhoods (cheap; one LLM-free pass)

```
@collision neighborhoods --workdir D:\collisions
```

Reads `translation-results.json`, derives collision neighborhoods
directly from translator misroute edges, computes per-action gravity,
writes:

- `D:\collisions\neighborhoods.json` — the cases to attack, ranked by
  gravity
- `D:\collisions\neighborhoods.html` — open in browser; sanity-check
  that the top cases look like real collisions

Eyeball this before spending tokens on `explore`. If the top
neighborhoods look wrong, the rest of the pipeline produces worthless
candidates.

---

## 4. Smoke test the explore engine (LLM-free)

```
@collision optimize explore --top 1 --lever jsdoc --depth 0 --dry-run \
    --workdir D:\collisions
```

Writes `D:\collisions\optimization-run-<ts>/`. Confirm it has:

- `cases/case-001-…/case.json`
- `cases/case-001-…/attempts/h01-jsdoc-dryrun/proposal.json` (with
  `"dryRun": true`)
- `cases/case-001-…/attempts/h01-jsdoc-dryrun/evaluation.json`
- `optimization-run.json` with the `corpusCoverage` summary
- `sandbox/agents/<schema>/` populated

No LLM calls happen. If this fails, the issue is sandbox setup or
`neighborhoods.json` — fix before going further.

---

## 5. Single-lever real run (~6 LLM calls)

```
@collision optimize explore --top 1 --lever jsdoc --depth 0 \
    --workdir D:\collisions
```

That's **1 case × 1 lever × K=3 hypotheses + 3 probes ≈ 6 LLM calls**.
Bounded cost. Look at:

- `cases/case-001-…/attempts/h01-jsdoc/proposal.json` — see what the LLM
  proposed, the `mechanism`, the new JSDoc text
- `cases/case-001-…/attempts/h01-jsdoc/evaluation.json` — `rescues` /
  `regressions` count
- `cases/case-001-…/winner.json` — the chosen attempt (or `null` if
  nothing scored > 0)
- `sandbox/agents/<schema>/schema.{ts,pas.json}` — diff against
  `.original/` to see the actual edit

This is the loop's "is the lever doing anything sensible?" check.

---

## 6. Validate the winner (LLM-bounded by corpus size)

```
@collision optimize validate --workdir D:\collisions
```

Picks the latest run, stacks all winners, re-probes the full corpus.
Writes:

- `optimization-impact.html` — open in browser. Top of the page shows
  total `rescued` / `regressed`, plus the **winners table** with
  cross-neighborhood-regression flags.
- `optimization-impact.json` — the same data, machine-readable.

Negative-test idea: hand-edit one winner's `proposal.json` to point at
a different action that doesn't exist, re-run `validate` — should
explode loudly.

---

## 7. Full sweep (real cost)

```
@collision optimize explore --top 5 --depth 2 --workdir D:\collisions
```

Worst case: **5 cases × 4 levers × K=3 × up to 3 depth rounds ×
(1 propose + 1 probe) ≈ 360 LLM calls**. Mid-three-figure dollars on
Azure OpenAI; budget accordingly.

Cost-reducing knobs:

- `--depth 0` — drop the recursion budget (×3 saving)
- `--lever jsdoc,manifest` — restrict to two levers (×2 saving)
- `--top 2` — fewer cases
- `--hypotheses-per-lever 1` — K=1 instead of K=3 (×3 saving)

---

## 8. The 5-step pipeline (everything end-to-end)

```
@collision optimize run --top 3 --workdir D:\collisions
```

Runs `neighborhoods → explore → validate → patterns → distill` in
order. Predecessor-gated, so re-running with `--from validate` skips
the first two steps (useful when explore was expensive and you just
want to re-validate).

`run` invokes `distill` automatically at the end, but gates on
`--distill-min-attempts 10` (default). When `patterns.jsonl` has fewer
winners, the distill step exits cleanly with a "not enough data"
placeholder rather than producing junk candidates.

`--skip-distill` opts out of the final step entirely.

---

## 9. Cross-run pattern mining + guideline distillation

After a few `run` cycles, `patterns.jsonl` accumulates. Once you cross
~10 winners:

```
@collision optimize patterns --workdir D:\collisions
@collision optimize distill --workdir D:\collisions
```

`patterns.html` shows three orthogonal grids:

1. Primary: `FailurePattern × Mechanism` (aggregated across levers)
2. Per-lever drill-downs
3. `FailurePattern × Lever` lever-effectiveness

Plus a classifier-agreement matrix (heuristic vs. LLM-refined
classification).

`distill` writes `schemaGuidelines.candidates.md` with LLM-proposed
additions to the canonical guidelines.

### Promoting a candidate

**Operator action by hand:**

1. Open `D:\collisions\schemaGuidelines.candidates.md`.
2. Pick a candidate whose evidence looks solid (high winner count,
   distinct neighborhoods, no anti-example smells).
3. Copy its proposed text into the relevant section of
   [`translation/schemaGuidelines.ts`](../../ts/packages/dispatcher/dispatcher/src/translation/schemaGuidelines.ts).
4. `pnpm --filter agent-dispatcher build`.

The next `explore` run reads the updated guidelines automatically —
every lever's propose prompt AND the case analyzer's LLM-refinement
import the same constant. The optimizer learns from its own wins.

---

## 10. Out-of-process / scheduled (no dispatcher shell)

```bash
node packages/defaultAgentProvider/dist/collisions/optimizationRunner.js \
    --workdir D:\collisions \
    --top 3 \
    --depth 2
```

Same pipeline; spins up its own dispatcher in read-only mode. Wire this
to Windows Task Scheduler or cron and let `optimization-run-<ts>/`
directories accumulate. `patterns.jsonl` aggregates across runs;
distill gets better as the dataset grows.

The runner forwards all dispatcher output to stderr — stdout stays
clean for piping the eventual summary into log aggregators.

---

## Applying a winner to your real source by hand

Each attempt directory has the patched files in
`sandbox/agents/<schemaName>/`. To apply a winner:

1. Open `cases/case-NNN-…/winner.json` to identify the attempt id.
2. Diff `sandbox/agents/<schema>/schema.ts` against
   `sandbox/.original/agents/<schema>/schema.ts` — that's what would
   change.
3. Manually apply the change to the real
   `packages/agents/<schema>/src/...Schema.ts` (or `.pas.json` for
   PAS-only agents).
4. Rebuild the agent. Re-run `@collision corpus translate` to confirm
   the rescue counts match `evaluation.json`.

The orchestrator never mutates your real source — the manual workflow
is by design.

---

## Common gotchas

- **`neighborhoods.json` not found** — run `@collision corpus generate`
  + `@collision corpus translate` first to produce
  `translation-results.json`, then `@collision neighborhoods`. The
  optimize commands assume both upstream artifacts exist.
- **PAS-only agents** — most agents in the repo (player, calendar,
  email, list, browser) ship as `.pas.json`. The sandbox supports this;
  edits go to the action's PAS `description` rather than a JSDoc block.
  If you eyeball a winner's patch and don't see TypeScript, that's why.
- **Empty `patterns.html`** — defaults `--min-attempts 5`. Run more
  cycles or pass `--min-attempts 1`.
- **`distill` says "not enough data"** — defaults `--min-attempts 10`
  winners. Either accumulate more runs or pass `--min-attempts 3` to
  force it.
- **Sandbox drift between runs** — every run snapshots `.original/`
  fresh; reverts are per-attempt. If you suspect state pollution, delete
  the `optimization-run-<ts>/` dir and re-run.
- **LLM rate limits** — bump down `--concurrency` (default 8) if you
  hit 429s.

---

## Where everything lives

```
D:\collisions\                                  ← --workdir
├── corpus.json                                 ← step 1a output
├── translation-results.json                    ← step 1b output (baseline)
├── neighborhoods.{json,html}                   ← step 3 output
├── patterns.jsonl                              ← appends across runs
├── patterns.{json,html}                        ← step 9 output
├── schemaGuidelines.candidates.md              ← step 9 output (operator promotes)
└── optimization-run-<ts>/
    ├── optimization-run.json                   ← index of cases + coverage
    ├── optimization-impact.{json,html}         ← validate output
    ├── sandbox/
    │   ├── .original/                          ← pristine snapshot
    │   ├── agents/<schemaName>/                ← live sandbox state
    │   ├── overrides/                          ← prune-lever filters
    │   └── proposalsApplied.json               ← validate's stack journal
    └── cases/case-NNN-<schema>.<action>/
        ├── case.json
        ├── winner.json
        └── attempts/h0X-<lever>{-rN}/
            ├── proposal.json
            └── evaluation.json
```

Start with steps 1–5. Once that loop feels predictable, move to step 8
and let `patterns.jsonl` accumulate. Promote distilled candidates into
`schemaGuidelines.ts` after a few cycles to close the feedback loop.
