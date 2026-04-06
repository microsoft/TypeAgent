# NLU Dataset Distribution Analysis

Analysis of vocabulary and sentence structure distributions in SNIPS NLU Benchmark
and Amazon MASSIVE datasets, used to inform grammar generation strategy.

**Date**: 2026-03-05
**Script**: `test/data/analyzeDistribution.cjs`
**Datasets**: SNIPS (PlayMusic + AddToPlaylist), MASSIVE en-US (music/audio intents)

---

## 1. Verb Concentration — Zipf's Law

Leading-word frequency for each intent shows a strong Zipfian distribution,
but the concentration varies dramatically by action type.

### "Transitive" actions (verb + entity)

| Intent              | Top verb | Coverage | Top 5 coverage |
| ------------------- | -------- | -------- | -------------- |
| SNIPS PlayMusic     | "play"   | 79.0%    | 93.5%          |
| SNIPS AddToPlaylist | "add"    | 73.2%    | 93.6%          |
| MASSIVE play_music  | "play"   | 47.9%    | 71.2%          |

A single verb dominates 50-80% of utterances. Top 5 verbs cover >90% (SNIPS)
or >70% (MASSIVE, which includes more "please"/"I want" prefixes).

### "Control" actions (no entity or numeric entity)

| Intent                    | Top verb | Coverage | Top 5 coverage |
| ------------------------- | -------- | -------- | -------------- |
| MASSIVE audio_volume_up   | "turn"   | 14.8%    | 54.8%          |
| MASSIVE audio_volume_down | "lower"  | 19.7%    | 60.6%          |
| MASSIVE audio_volume_mute | "mute"   | 19.7%    | 50.9%          |
| MASSIVE music_settings    | "repeat" | 21.5%    | 55.3%          |

No single verb exceeds 22%. Top 5 cover only 50-60%. Vocabulary is 3x more
distributed than transitive actions.

### Implication for grammar generation

- **Transitive actions**: The dominant verb + 4-5 synonyms covers >90%.
  Grammar warmer should generate fewer verb variants per batch — most value
  comes from parameter structure diversity, not verb diversity.
- **Control actions**: Need 8-12 verb variants to reach 90% coverage.
  Grammar warmer should generate more verb variants per batch and explicitly
  enumerate verb synonym groups.

---

## 2. Sentence Form Distribution

Remarkably stable across all intents in both datasets:

| Form       | SNIPS PlayMusic | SNIPS AddToPlaylist | MASSIVE play_music | MASSIVE vol_up | MASSIVE vol_down |
| ---------- | --------------- | ------------------- | ------------------ | -------------- | ---------------- |
| Imperative | 88.9%           | 89.8%               | 88.9%              | 86.7%          | 91.5%            |
| Desire     | 7.5%            | 6.2%                | 7.4%               | 5.2%           | 1.4%             |
| Question   | 3.6%            | 3.2%                | 3.7%               | 8.1%           | 7.0%             |

**Central tendency**: ~89% imperative, ~6% desire ("I want to..."), ~5% question ("Can you...")

### Desire form breakdown (SNIPS PlayMusic)

| Phrase        | Count | % of all |
| ------------- | ----- | -------- |
| "I want to"   | 116   | 5.8%     |
| "I'd like to" | 19    | 0.9%     |
| "I wanna"     | ~5    | ~0.3%    |
| "I need"      | ~5    | ~0.3%    |

### Question form breakdown (SNIPS PlayMusic)

| Phrase     | Count | % of all |
| ---------- | ----- | -------- |
| "Can you"  | 53    | 2.6%     |
| "Can I"    | 13    | 0.7%     |
| "Will you" | 4     | 0.2%     |

### Implication for test set generation

Test sets should reflect the 89/6/5 split, not uniform distribution. LLMs
tend to over-generate question forms when asked for "diverse" phrasings.
The test set prompt should explicitly request this weighting.

---

## 3. Template Diversity — The Long Tail

### SNIPS PlayMusic (2000 utterances)

- **1,228 unique structural templates** (1.6x reuse ratio)
- Top 20 templates cover only 11.6% of all utterances
- Most common single template: "Play [track] by [artist]" — only 1.0%
- The long tail is enormous: 1000+ templates appear only once

### SNIPS AddToPlaylist (1942 utterances)

- **782 unique templates** (2.5x reuse ratio)
- Higher reuse because parameter structure is simpler (entity + playlist)

### Implication

A grammar cannot capture every variant. The 90% hit-rate target is
realistic — we aim for the **head** of the distribution. The **tail**
(~10%) falls through to the LLM translator. This is by design.

---

## 4. Entity Combination Patterns

### SNIPS PlayMusic — Entity usage frequency

| Entity     | Frequency | % of utterances |
| ---------- | --------- | --------------- |
| artist     | 1172      | 58.6%           |
| music_item | 792       | 39.6%           |
| service    | 762       | 38.1%           |
| year       | 635       | 31.8%           |
| sort       | 347       | 17.3%           |
| track      | 211       | 10.5%           |
| album      | 177       | 8.8%            |
| playlist   | 149       | 7.4%            |
| genre      | 144       | 7.2%            |

### Most common entity combinations (SNIPS PlayMusic)

| Combination                          | Count | %    |
| ------------------------------------ | ----- | ---- |
| artist + music_item                  | 119   | 5.9% |
| artist (alone)                       | 109   | 5.5% |
| music_item + year                    | 106   | 5.3% |
| playlist (alone)                     | 98    | 4.9% |
| service (alone)                      | 91    | 4.5% |
| artist + year                        | 89    | 4.5% |
| genre (alone)                        | 87    | 4.3% |
| artist + track                       | 85    | 4.3% |
| year (alone)                         | 76    | 3.8% |
| artist + service                     | 71    | 3.5% |
| artist + sort                        | 68    | 3.4% |
| artist + music_item + sort           | 67    | 3.4% |
| artist + music_item + service + sort | 63    | 3.1% |
| artist + music_item + year           | 60    | 3.0% |
| album + artist                       | 58    | 2.9% |

### Implication

Each entity combination creates a different template family:

- "play X by Y" (track + artist)
- "play X from 2020" (track + year)
- "play my X playlist" (playlist alone)
- "play some jazz" (genre alone)
- "play some X" (artist alone)

The grammar warmer should explicitly enumerate these parameter structures
and generate patterns for each, rather than relying on LLM imagination
to discover them.

---

## 5. Comparison to Hand-Written Player Grammar

The hand-written `playerSchema.agr` covers:

| Action                   | # patterns | Coverage of SNIPS/MASSIVE                |
| ------------------------ | ---------- | ---------------------------------------- |
| pause                    | 3          | Adequate                                 |
| resume                   | 3          | Adequate                                 |
| next/skip                | 3          | Adequate                                 |
| playTrack                | 3          | Only track+artist and track+album combos |
| playFromCurrentTrackList | 3          | Adequate                                 |
| selectDevice             | 8          | Adequate                                 |

### Actions NOT in hand-written grammar (but common in SNIPS/MASSIVE)

| Action       | Real-world evidence                                        |
| ------------ | ---------------------------------------------------------- |
| playRandom   | "play some music" = 11.1% of SNIPS bigrams                 |
| playArtist   | artist-alone = 5.5% of SNIPS entity combos                 |
| playGenre    | genre = 7.2% of SNIPS entity usage                         |
| playAlbum    | album = 8.8% of SNIPS entity usage                         |
| playPlaylist | playlist = 7.4% of SNIPS entity usage                      |
| setVolume    | MASSIVE volume cluster: 387 utterances across 4 intents    |
| changeVolume | "turn up/down" = 15% of MASSIVE volume intents             |
| shuffle      | "repeat"/"shuffle" = 28% of MASSIVE music_settings leading |
| searchTracks | "find"/"search" = 3% of SNIPS leading words                |

The grammar warmer is responsible for generating patterns for ALL these actions.

---

## 6. Politeness as Orthogonal Concern

MASSIVE shows "please" as a leading word at 8-15% across intents (vs 2% in SNIPS).
Our phrase-set matcher `<Polite>` handles this orthogonally via:

```
(<Polite>)? <ActionPattern>
```

This is confirmed as the right design by the data — "please" is never part of
the action's structural template, just a prefix.

---

## 7. Summary of Improvements

Based on this analysis, three changes to the grammar warmer:

### A. Verb budget allocation by action type

Classify actions as "transitive" (entity-heavy) vs "control" (no entity /
numeric entity). Transitive actions get smaller verb batches (5-6 verbs cover
90%+) while control actions get larger verb batches (10-12 needed for 90%).

### B. Parameter structure enumeration

For each action, enumerate the valid parameter combinations from the schema
(e.g., track alone, track+artist, track+album, artist alone, genre alone)
and explicitly instruct the generator to produce patterns for each combination.
This is the main driver of template diversity.

### C. Sentence form weighting in test sets

Encode the empirical 89/6/5 imperative/desire/question split in the test set
generator prompt. This prevents over-representation of question forms in
test sets, which would either inflate or deflate the measured hit rate relative
to real-world performance.
