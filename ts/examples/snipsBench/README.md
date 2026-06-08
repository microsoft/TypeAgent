<!-- Copyright (c) Microsoft Corporation.
     Licensed under the MIT License. -->

# snips-bench

Benchmarking the **action-grammar** engine on the [SNIPS](data/SOURCE.md)
natural-language-understanding task (intent + slot filling), and using it to ask
a focused question:

> Does cheap, finite-state "parsing" — coarse POS / noun-phrase chunking —
> improve grammar-based slot filling?

The short answer, with evidence below: **no, not as a slot-boundary signal.**
The lever that matters is _carrier-phrase coverage_, which is obtained far more
cheaply by **inducing the grammar from data** than by hand-authoring it — and
induction also subsumes the boundary logic that POS typing was meant to provide.

## Run

```bash
pnpm --filter snips-bench build
node dist/main.js test          # M2 (hand-authored) + M3 (induced), minFreq=2
node dist/main.js test 1        # M3 induced with minFreq=1
```

Every run first proves the harness is sound: a scorer self-test (hand-computed
P/R/F1) and an **oracle** (gold-as-pred) that must score 100/100. All reported
numbers are CoNLL entity-level slot F1, evaluated per intent on its gold test
subset (intent given) and micro-pooled across intents.

## The three arms

The experiment holds the grammar fixed and varies only the _slot wildcard type_:

| arm           | slot capture                | boundary rule                                                                        |
| ------------- | --------------------------- | ------------------------------------------------------------------------------------ |
| `wildcard`    | greedy, unbounded           | stops at the next literal anchor in the grammar                                      |
| `NP`          | greedy, per-token validated | stops at the first **function word** (strict content/function NP)                    |
| `title-aware` | `wildcard` capture, refined | keep leading determiners + medial glue; trim **trailing** glue + structural keywords |

`NP` is a first-class entity type registered on the engine (`npEntity.ts`),
backed by a closed-class lexicon + suffix tagger (`pos.ts`). `title-aware` is a
positional post-pass (`refine.ts`) — the rule a position-aware, engine-integrated
bounded wildcard would enforce.

## Results

### Hand-authored grammars (M2)

| arm           | pooled slot F1 | precision | recall |
| ------------- | -------------- | --------- | ------ |
| `wildcard`    | **23.4**       | 47.4      | 15.5   |
| `NP`          | 11.6           | 60.5      | 6.4    |
| `title-aware` | 23.5           | 47.8      | 15.6   |

### Induced grammars (M3, template induction from the train split)

| arm           | pooled slot F1 | precision | recall |
| ------------- | -------------- | --------- | ------ |
| `wildcard`    | **35.3**       | 42.7      | 30.1   |
| `NP`          | 13.5           | 55.9      | 7.7    |
| `title-aware` | 34.0           | 41.9      | 28.5   |

Per-intent coverage jumps sharply under induction (SearchCreativeWork 66→93%,
RateBook 22→91%, BookRestaurant 6.5→51%, GetWeather 54→78%), and induction
**learns slot labels from carrier context** — GetWeather, whose city/state/country
labels need world knowledge a hand grammar can't supply, rises from F1 4.0 → 26.7.

### Coverage / threshold sweep (induced, `wildcard`)

| minFreq | pooled F1 | recall |
| ------- | --------- | ------ |
| 1       | **37.3**  | 33.0   |
| 2       | 35.3      | 30.1   |
| 3       | 32.7      | 26.4   |
| 5       | 28.6      | 21.9   |

F1 tracks recall, which tracks how many carrier-phrase templates are kept. The
`wildcard > title-aware > NP` ordering is identical at every threshold.

## What this shows

1. **POS / NP typing does not help slot boundaries here.** Strict `NP` has the
   _highest precision_ in every setting (cleaner boundaries when it fires) but
   _collapses recall_ — real slot values are titles and names full of function
   words ("this is selena", "don't drink the water"), which a content/function
   rule chokes on. It is a large net loss.

2. **Title-aware refinement is neutral-to-negative.** It recovers NP's precision
   without the recall cost, but only helps title-heavy slots; in the induced
   regime it slightly _hurts_, because the learned templates already encode the
   trailing-keyword / boundary variation it tries to hard-code (e.g. both
   `… {playlist}` and `… {playlist} playlist` are learned as separate templates).

3. **The boundary work is done by anchors, not syntax.** In a hand grammar the
   literal carrier words ("to", "by", "out of") already pin boundaries; in an
   induced grammar the learned carrier phrases do. POS typing is redundant with
   anchors, which is why it never wins.

4. **Induction beats hand-authoring decisively** (+12 F1) and is cheaper. Each
   delexicalized template generalizes over slot _fillers_, so even rarely-seen
   carrier phrases are useful (minFreq=1 is best). The remaining ceiling is
   **recall**: exact carrier-phrase matching is brittle, so test utterances whose
   phrasing wasn't seen in train (~67% of gold spans at the cap) get no match.

## Implication: toward a lightweight fast translation model

The bottleneck is **generalizing surface variation to templates**, not syntax.
A lightweight, fast NL→action model should therefore invest in:

- **Soft/fuzzy carrier-phrase matching** (paraphrase, optional glue, word order)
  to lift the recall ceiling that exact templates hit — this is where the real
  headroom is, not POS features.
- **Open-vocabulary slot filling by context**, with the slot _label_ inferred
  from the carrier phrase (as induction already does) rather than from a
  gazetteer.
- Treating hand grammars as a _cold-start_ only; **induce from logged
  interactions** and let coverage compound.

## Layout

```
data/                SNIPS BIO split (see SOURCE.md)
src/data.ts          loader, BIO ↔ spans
src/score.ts         CoNLL slot F1 + intent accuracy (self-tested)
src/pos.ts           coarse POS: closed-class lexicon + suffix tagger
src/npEntity.ts      NP + Num entity types registered on the engine
src/refine.ts        title-aware positional boundary refinement
src/grammar.ts       hand-authored grammar templates (7 intents)
src/induce.ts        grammar induction by delexicalization
src/runner.ts        compile → matchNFA → extract slots → recover spans
src/main.ts          harness: oracle/self-test + M2/M3 scoreboards
src/debug.ts         dev bisection harness
```

### Engine notes

- A wildcard compiles to a greedy self-loop; a _typed_ wildcard validates
  per-token, giving unbounded function-word-bounded capture. `MAX_ENTITY_LOOKAHEAD`
  caps only the whole-span optimization, not total capture length.
- The match result exposes slot **values**, not token spans; `runner.recoverSpans`
  recovers spans by token-subsequence alignment.
- **Bug found:** an optional _rule-reference_ (`to <Owner>? grime …`) silently
  fails to match (consumes tokens, never accepts); an inline optional group
  `(my|the)?` works. Worth a minimal-repro report against actionGrammar.
