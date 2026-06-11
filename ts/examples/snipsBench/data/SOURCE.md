<!-- Copyright (c) Microsoft Corporation.
     Licensed under the MIT License. -->

# SNIPS dataset provenance

This directory vendors the **SNIPS 2017** natural-language-understanding benchmark
in the BIO-tagged, train/valid/test split popularized by:

> Goo et al., "Slot-Gated Modeling for Joint Slot Filling and Intent Prediction",
> NAACL-HLT 2018.

It is the split everyone reports SNIPS slot-F1 / intent-accuracy numbers against.

## Origin

- Underlying data: **SNIPS Voice Platform** "2017-06-custom-intent-engines"
  benchmark, originally released by Snips for research/benchmarking
  (https://github.com/snipsco/nlu-benchmark).
- Preprocessed BIO split mirrored from the JointBERT repository
  (https://github.com/monologg/JointBERT, `data/snips/`), which is the
  widely-used copy of the Goo et al. preprocessing. JointBERT's `dev` split is
  vendored here as `valid/`.

Retrieved 2026-06-05.

## Layout

```
data/<split>/
  seq.in    # one utterance per line, space-tokenized
  seq.out   # aligned BIO slot tags, space-separated (same token count per line)
  label     # one intent label per line
```

| split | utterances |
| ----- | ---------- |
| train | 13,084     |
| valid | 700        |
| test  | 700        |

- 7 intents: AddToPlaylist, BookRestaurant, GetWeather, PlayMusic, RateBook,
  SearchCreativeWork, SearchScreeningEvent.
- 39 slot types.

## Licensing note

The SNIPS benchmark data was released by Snips for research and benchmarking.
This copy is included solely to make the action-grammar benchmark reproducible.
Refer to the upstream repositories above for the authoritative terms governing
the underlying data.
