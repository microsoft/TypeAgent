<!-- Copyright (c) Microsoft Corporation. Licensed under the MIT License. -->

# contextSelector metric benchmark (offline, deterministic)

Measures the context-weighted collision-resolution tier (`contextSelector`) as
**three separate metrics**, across several corpora so the numbers actually
discriminate:

- **realistic dialogue** — 250 hand-authored natural conversations across five
  difficulty tiers (grounded in the featured agents' real keyword vectors):
  **50 simple** (obvious single-agent) + **50 no-context** (cold-start / zero
  relevant signal) + **50 realistic** + **50 hard edge cases** + **50 extra-hard
  adversarial stress tests** (loaded negation, sarcasm, quoted speech). Labeled by
  honest human intent, NOT tuned to pass. The extra-hard set is a breaking-points
  probe, kept OUT of the calibration/sweep corpus.
- **real pairs (clear/vague)** — ≥10 curated confusable **real-agent**
  comparisons (player vs playerLocal, powershell vs taskflow, code-debug vs
  visualStudio, timer vs windowsClock, …), each driven with an **even mixture**
  of _clear_ conversations (obviously one agent) and _vague_ ones (shared
  vocabulary). Shows how the metrics move with ambiguity.
- **siblings** — a family of confusable synthetic "vampire" siblings (~60% shared
  vocabulary) that stress the evidence gate hardest.
- **easy** — whole-roster auto pairs (near-disjoint vectors); a saturating
  _floor_.

Everything runs on the real ring-buffer decay, the real TF-IDF strategy, and the
real decision rule. **No LLM, no dispatcher boot, fully deterministic.**

The three metrics map one-to-one to the questions "are we retrieving context,
triggering only when required, and resolving correctly?":

| Metric                        | Question                                                              | Key numbers                                             |
| ----------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------- |
| **1. Context retrieval**      | Does the signal source surface the conversation's real topic?         | topic mass share, topic-is-strongest, 5 contract checks |
| **2. Trigger discipline**     | Do we resolve only when required, and abstain otherwise (vice versa)? | yield, abstention-correctness, spurious-resolve         |
| **3. Resolution correctness** | When we do resolve, do we route to the right agent?                   | target accuracy, wrong-target, WRR                      |

Each metric is reported per-slice; metrics that don't apply to a slice (yield for
an all-vague slice, abstention for an all-clear slice) show `n/a`.

## Run

```bash
cd packages/dispatcher/dispatcher
npx tsx src/validation/contextselector/measureMetrics.mts --out <output-dir>
```

Writes `contextSelector-metrics.{md,json}` to `--out` (default: cwd). No build
needed — `tsx` runs the `.mts` files against the TypeScript sources directly, and
the committed keyword files live in each agent's `src/`.

Type-check the harness with `npx tsc --noEmit -p src/validation/contextselector/tsconfig.metrics.json`.

## Files

- **`metricRoster.mts`** — loads every committed `*.keywords.json` across
  `packages/agents` and exposes them through the production
  `KeywordIndex.effective()` read path (empty sidecar). `buildRoster()` is shared
  with the adversary so both exercise identical scoring machinery.
- **`metricRealisticDialogue.mts`** — the **dialogue** slice: 250 hand-authored
  natural conversations = 50 simple + 50 no-context + 50 realistic + 50 hard + 50
  extra-hard adversarial (tagged `difficulty`/`category`), grounded in the agents'
  real keyword vectors and verified against the real scorer. **Edit `SCENARIOS` to
  add your own** — a scenario's `dialogue` is just an array of natural sentences.
- **`metricCorpus.mts`** — deterministic, self-labeling corpus for the **easy**
  slice: manufactures collisions from real overlapping-agent pairs and composes
  preludes from each agent's own discriminating keywords. Also exports the shared
  helpers (`turnFrom`, `makePrng`, `sample`, `shared`).
- **`metricRealPairs.mts`** — the **real-agent clear/vague** slice: ≥10 curated
  confusable real pairs. CLEAR conversations are realistic (mostly shared domain
  vocabulary with a gradient of 3/2/1 discriminating "tells", so the gate decides
  recall); VAGUE conversations are shared-only or balanced (ground truth: abstain).
- **`metricAdversary.mts`** — the **siblings** slice: 8 confusable synthetic
  occult siblings, each `SHARED occult vocab ∪ small UNIQUE set`. Resolve fixtures
  span a signal grid so the **evidence gate — not the fixture author — decides
  yield**.
- **`metricRunner.mts`** — the three-metric engine. Metric 1 scores the signal
  source in isolation (topical mass + pinned contract property checks); metrics 2
  and 3 score the full resolve/abstain decision and the resolved target.
- **`measureMetrics.mts`** — entry point: runs the three metrics per-slice at the
  shipped defaults, runs the B-6 threshold sweep on the combined corpus, and
  writes the report.
- **`compareLlm.mts`** — the **LLM comparison** (the only online, LLM-dependent
  script): runs the real `aiclient` model (the standard resolution path's LLM) as
  a "contextSelector OFF" arm on all 250 collisions and reports, per tier,
  LLM-only accuracy vs contextSelector-ON system accuracy, plus **regressions**
  (CS resolves wrong where the LLM would be right) and **savings** (correct
  resolves that avoid an LLM call). Responses are cached to `llm-cache.json` so
  re-runs are free; run: `npx tsx src/validation/contextselector/compareLlm.mts`.

## Interpreting the result

**250-test report by tier (the headline).** Every conversation is scored by the
real pipeline; the tier gets _safer-but-quieter_ as difficulty climbs:

| Tier                 | Yield | Resolution acc | Abstention | Spurious / wrong-target | Retrieval share | Lift |
| -------------------- | ----- | -------------- | ---------- | ----------------------- | --------------- | ---- |
| **Simple (50)**      | 100%  | 100%           | 100%       | 0 / 0                   | 100%            | +33% |
| **No-context (50)**  | n/a   | n/a            | **100%**   | 0 / 0                   | n/a             | +0%  |
| **Realistic (50)**   | 100%  | 100%           | 100%       | 0 / 0                   | 97%             | +44% |
| **Hard (50)**        | 58%   | 100%           | 100%       | 0 / 0                   | 73%             | +27% |
| **Adversarial (50)** | 82%   | **7%**         | 45%        | 18 / 13                 | 33%             | +0%  |

- **No-context** is the cold-start / zero-signal collision (empty history, greetings,
  unrelated chatter): the tier abstains on **50/50** and never guesses — it simply
  falls through to today's routing. This is the pure safety baseline.

- **Simple / Realistic:** flawless — resolves the obvious ones, abstains on the
  empty ones, 0 misroutes.
- **Hard:** yield drops to 58% (conservative safe-misses on thin/vocabulary-gap
  signal) but resolution accuracy stays 100% and wrong-target stays 0.
- **Adversarial:** the tier _breaks_ — resolution accuracy craters to **7%** (when
  it resolves under attack it is almost always wrong) and routing lift falls to
  **+0%** (no better than first-match). This is by construction: negation,
  sarcasm, and quoted speech defeat lexical matching and need a semantic/LLM tier.

**contextSelector vs the full LLM path (`compareLlm.mts`).** The most decision-
relevant comparison: how does contextSelector's routing stack up against the
standard path with it OFF (the LLM disambiguating the collision)?

| Tier        | LLM-only acc (CS off) | CS-ON system acc | LLM calls saved | Regressions |
| ----------- | --------------------- | ---------------- | --------------- | ----------- |
| Simple      | 100%                  | 100%             | 36              | **0**       |
| Realistic   | 76%                   | 76%              | 34              | **0**       |
| Hard        | 84%                   | 86%              | 19              | **0**       |
| Adversarial | 56%                   | **18%**          | 32              | **19**      |

- **On simple/realistic/hard, contextSelector is strictly additive:** it matches
  or slightly beats the LLM-only path with **0 regressions**, while saving 89 LLM
  calls (correct answers delivered deterministically). It is even a touch _more_
  conservative than the LLM, which tends to over-commit on genuinely ambiguous
  input where contextSelector correctly abstains.
- **On adversarial input it is harmful:** turning it ON drops system accuracy from
  56% (LLM-only) to **18%**, causing **19 regressions** — collisions it confidently
  misroutes (loaded negation, sarcasm, quoted speech) that the LLM alone would have
  routed correctly. The LLM is far from perfect here (56%) but it is not _fooled_
  the way lexical matching is.
- **Net:** contextSelector is a safe, call-saving win on realistic traffic and a
  liability only under adversarial phrasing — which reinforces the mitigation
  (bias to abstention + a negation guard so those cases fall through to the LLM
  instead of resolving).

**Realistic dialogue (the ship-confidence set).** Across the 100 simple+realistic
+hard non-adversarial conversations:

- **Normal (50): 50/50 correct** — 0 misroutes, 0 false alarms.
- **Hard (50): 36 correct, 14 safe-miss, 0 wrong-target, 0 spurious.** The 14
  failures are all _safe_ — the tier conservatively abstained on genuinely
  under-specified input (single-word "tells", slang not in any keyword vector),
  falling through to today's routing rather than guessing. The per-category
  breakdown shows _where_: `thin-signal` and `vocab-gap` account for most misses;
  `trap` (distractor injection), `topic-shift`, `near-tie`, and `stale` are
  handled correctly.
- **The safety claim: 0 wrong-target across all 100 realistic conversations** —
  even the hard edge cases never misroute; their 14 failures are all safe
  conservative abstains.

**This is empirically why the gate ships `minUniqueTokens=2`.** On the realistic
combined corpus (incl. the 50 hard dialogues), the B-6 sweep shows **4 cells
produce a wrong-target — all of them at `minUniqueTokens=1`**. A single-token
evidence gate misroutes on the hard edge cases; raising it to 2 (the shipped
default) restores 0 wrong-target.

**Adversarial stress test (50 extra-hard) — where it breaks.** These are
deliberately crafted to confuse the scorer and are **excluded from the
calibration corpus**. Under attack it fails **31/50** (13 wrong-target + 18
spurious), concentrated exactly where lexical matching is blind:

- **Loaded negation → 9/9 misroute.** The scorer counts negated words as positive
  signal, so "NOT a debugger, forget the thread/stack/memory… just fix the bug"
  routes to the negated (heavier) agent. This is the single biggest limitation.
- **Sarcasm → 7/7 spurious**, **quoted speech → 4 misroute** — the tier fires on
  surface words the user is mocking or quoting from someone else.
- **Third-agent distractors and rapid churn → spurious** (overlapping vocabulary
  bleeds enough mass to trip a resolve).
- **Safe under attack:** typos (5/5) and homonyms (4/5) lose their signal and
  correctly abstain — a garbled keyword can't misroute.

The takeaway: **these need semantic understanding (an LLM tier), not lexical
tuning.** contextSelector is safe on realistic conversation but must fall through
to the LLM on negation/sarcasm/quotation; a deployment could add a negation-word
guard (force abstain when "not/no/never" precedes the discriminating tokens).

**Real-agent comparisons.** On ≥10 confusable real-agent pairs, the metrics
**switch** with ambiguity: clear conversations → yield ~67%, resolution accuracy
100%; vague conversations → abstention 100%, spurious 0%.

**The siblings slice** stresses the gate hardest: **yield ~46%** on ~60%-shared
synthetic siblings — the number a clean corpus would hide — while wrong-target
stays 0 and abstention 100%.

**Invariants that must always hold:** 0 wrong-target and no-regression on every
slice (the tier is "strictly additive, never worse than today's routing"); the
5 retrieval-contract property checks (recency decay, windowing, history-only,
surface-form canonicalization, glue rejection).

**The threshold sweep** on the combined corpus shows the real safety/yield
tradeoff: loosening the gate (e.g. `minUniqueTokens=1, minMass=0.5`) buys yield
but leaks spurious resolves; the shipped default sits at the loosest fully-safe
point.

## Protections against the adversarial failures (grounded in the code)

The adversarial misroutes only matter under specific conditions, because the
tier is guarded several ways:

1. **OFF by default.** `collision.contextSelector.detect` and
   `collision.grammarMatch.detect` both default to `false`
   (`src/context/session.ts`), so with the shipped config the collision path is a
   no-op that uses first-match — _identical to legacy behavior_
   (`translation/matchRequest.ts:285-289`). The whole tier is opt-in.
2. **Collision-gated.** Even when enabled it only runs when `isCollision(...)` is
   true — a genuine ≥2-candidate grammar ambiguity. Single-match requests never
   reach it.
3. **Abstention-biased gates** (`decision.ts`): `minUniqueTokens=2`, `minMass=1.0`,
   `margin=0.5` catch thin / tie / stale / no-context inputs → abstain.
4. **Negation-scope guard** (`negationGuard`, default on): suppresses content words
   inside a negation scope so "not the spreadsheet" no longer deposits `spreadsheet`
   — see Improvements below.
5. **Abstain fallback** (`abstainFallback`): on abstain it defers to the
   configured strategy (first-match) or, if set to `escalate-to-llm`, hands the
   collision to the LLM. Either way an abstain is never worse than today.

## Improvements (prioritized)

- **P0 — negation guard (SHIPPED, measured).** `"not"`/`"no"` are stopwords
  (`tokenize.ts`), dropped before scoring, so the pre-guard scorer never saw the
  negation and the negated words fired. The lexical negation-scope guard
  (`tokenize.ts` `dropNegatedSpans`, enabled by the conversation signal via
  `contextSelector.negationGuard`, default on) suppresses content tokens from a
  negation cue to the next clause boundary / reset connector. Measured on this
  benchmark (`CS_NEGATION_GUARD=0` replays the pre-guard baseline):

  | adversarial tier      | guard off | guard on  |
  | --------------------- | --------- | --------- |
  | wrong-target resolves | 13        | **8**     |
  | resolution accuracy   | 7.1%      | **20.0%** |
  | retrieval share       | 32.7%     | **56.6%** |
  | combined wrong-target | 0         | **0**     |

  Zero safe-tier regressions (simple / no-context / realistic unchanged, hard
  wrong-target still 0; one hard scenario shifts correct→abstain, a safe miss).
  Cheap, deterministic, fits the §12 contract.

- **P1 — `escalate-to-llm` on abstain.** The LLM comparison shows the LLM is far
  better on hard/adversarial input; routing abstains to it (instead of
  first-match) captures that value safely.
- **P1 — quoted-speech suppression.** Discount discriminating tokens inside quotes
  or after reporting verbs (`said`, `insists`) — would catch the quoted misroutes.
- **P2 — global (roster-wide) IDF.** Tried and **measured net-negative** on this
  corpus (hard-tier spurious 0 → 2, adversarial wrong-target 8 → 9, accuracy
  20% → 10%; adversarial spurious barely moved 18 → 17). Root cause: the spurious
  resolves are driven by _rare_ third-agent distractor tokens, not broad ones, so
  a broadness weight can't target them and disturbs legitimate resolves. Reverted.
  The real third-agent fix is current-request token weighting or entity attribution
  (a larger change), not global IDF.
- **P3 — sarcasm** can't be caught lexically; keep the tier conservative and let it
  fall through to the LLM.
- **Rollout:** ship behind the `detect` flag with the existing collision telemetry,
  monitor wrong-resolution rate on real traffic, roll back if it spikes.

## Methodology & relationship to the static-collision benchmark

This benchmark is the **Tier-2 (end-to-end, scorer-level)** half of the collision
project's two-tier validation standard (design §13.4–13.5):

- **Tier 1 — deterministic unit fixtures (CI-gated):** the jest specs under
  `test/contextSelector*.spec.ts` (signal, tokenize, scorer, decision, strategy,
  scenarios) with **Gate A = zero wrong-target** and **Gate B = determinism**. Run
  by `pnpm run test:local` in CI.
- **Tier 2 — this offline benchmark:** replays the 250 labeled dialogues through
  the real signal → strategy → decision pipeline and rolls up the three metrics per
  difficulty tier. Deterministic, but **run manually** (not CI-gated).

It is a deliberately **different instrument** from the repo's other collision
benchmark, the **static-collision corpus probe** (`@collision corpus run`,
`packages/defaultAgentProvider/src/collisions/`), which measures a different stage
of the funnel. Key differences (see the standalone comparison report for the full
table + implications):

|                       | static-collision corpus (`@collision corpus`)                   | this contextSelector benchmark                                  |
| --------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| **signal under test** | embedding cosine similarity (the `static`/`llmSelect` ranker)   | lexical TF-IDF over a decayed conversation vector               |
| **unit**              | one single-turn phrase                                          | a multi-turn dialogue (prelude + collision)                     |
| **ground truth**      | LLM-authored phrase → its authoring action                      | hand-authored dialogue → labeled resolve/abstain                |
| **taxonomy**          | CLEAN / TIGHT / MISROUTE (top-1 correctness + margin, `Δ<0.05`) | resolve/abstain × correct / wrong-target / spurious / safe-miss |
| **determinism**       | non-deterministic (LLM authoring + embedding API)               | fully deterministic (no LLM, no network)                        |
| **execution**         | operational, manual, read-only session                          | offline script; jest half is CI-gated                           |
| **baseline**          | 9.8% CLEAN / 46.6% TIGHT / 43.6% MISROUTE (4258 phrases)        | per-tier yield / accuracy / abstention / wrong-target           |

The design intended `@collision corpus run` to double as the contextSelector's
end-to-end harness (§13.5); this benchmark instead re-implements a deterministic,
lexical, multi-turn sibling. The implication (detailed in the report) is that the
two are **complementary, not interchangeable**: the corpus probe measures the
embedding ranker's raw discrimination on single phrases, while this benchmark
measures the lexical context tier's resolve/abstain quality over conversations —
and only the latter is deterministic enough to gate in CI.

## Caveats

- Synthetic, self-labeled corpus — cleaner than real conversation; treat
  retrieval/yield as an upper-ish bound on lexical signal. The hard slice narrows
  that gap but is still lexical (paraphrase / non-lexical signal is a follow-up).
- Collisions are manufactured (candidate sets are inputs to the scorer); real
  grammar overlap is not required for an offline scorer benchmark.
- Not covered (follow-ups): L3 live agent-server replay, LLM-authored / terse
  preludes, and misroute-mined keyword sources.
