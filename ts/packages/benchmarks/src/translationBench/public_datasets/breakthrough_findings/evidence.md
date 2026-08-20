# Verification evidence

## Goal

Check whether the saved Seal-Tools and DroidCall artifacts support a large,
causal TypeAgent improvement. The final resources are `analyze.mjs`, its JSON
report, and the nine independent review files.

## Scope

No full benchmark was rerun. Verification rescanned the eight saved 1,000-row
DroidCall results and reran the existing ten-row dependency probe analysis.
The probe itself was not regenerated.

## Commands and raw output

Run the analysis from `ts/packages/benchmarks`:

```text
$ rtk proxy node src/translationBench/public_datasets/breakthrough_findings/analyze.mjs
src/translationBench/public_datasets/breakthrough_findings/evidence/cross-dataset-analysis.json
```

Check byte-for-byte reproducibility by running the analysis twice:

```text
$ rtk proxy node src/translationBench/public_datasets/breakthrough_findings/analyze.mjs
$ rtk proxy shasum -a 256 src/translationBench/public_datasets/breakthrough_findings/evidence/cross-dataset-analysis.json
48b309d3fb0daf710769465214c13af5d6ccdc7475c727155684d0995d3d4dd3  src/translationBench/public_datasets/breakthrough_findings/evidence/cross-dataset-analysis.json
$ rtk proxy node src/translationBench/public_datasets/breakthrough_findings/analyze.mjs
$ rtk proxy shasum -a 256 src/translationBench/public_datasets/breakthrough_findings/evidence/cross-dataset-analysis.json
48b309d3fb0daf710769465214c13af5d6ccdc7475c727155684d0995d3d4dd3  src/translationBench/public_datasets/breakthrough_findings/evidence/cross-dataset-analysis.json
```

Check formatting and syntax:

```text
$ rtk proxy pnpm exec prettier --check src/translationBench/public_datasets/breakthrough_findings/analyze.mjs src/translationBench/public_datasets/breakthrough_findings/README.md src/translationBench/public_datasets/breakthrough_findings/evidence.md src/translationBench/public_datasets/breakthrough_findings/reviews/**/*.md
Checking formatting...
All matched files use Prettier code style!

$ rtk proxy node --check src/translationBench/public_datasets/breakthrough_findings/analyze.mjs
(no output; exit 0)
```

Check review coverage and verdicts:

```text
$ rtk proxy find src/translationBench/public_datasets/breakthrough_findings/reviews -name 'reviewer-*.md' -type f | wc -l
9

$ rtk proxy rg '^## Verdict: ' src/translationBench/public_datasets/breakthrough_findings/reviews
src/translationBench/public_datasets/breakthrough_findings/reviews/typed-dataflow/reviewer-2.md:## Verdict: REJECT
src/translationBench/public_datasets/breakthrough_findings/reviews/typed-dataflow/reviewer-3.md:## Verdict: REJECT
src/translationBench/public_datasets/breakthrough_findings/reviews/typed-dataflow/reviewer-1.md:## Verdict: REJECT
src/translationBench/public_datasets/breakthrough_findings/reviews/argument-compiler/reviewer-2.md:## Verdict: REJECT
src/translationBench/public_datasets/breakthrough_findings/reviews/argument-compiler/reviewer-1.md:## Verdict: REJECT
src/translationBench/public_datasets/breakthrough_findings/reviews/argument-compiler/reviewer-3.md:## Verdict: REJECT
src/translationBench/public_datasets/breakthrough_findings/reviews/executable-evaluation/reviewer-2.md:## Verdict: REJECT
src/translationBench/public_datasets/breakthrough_findings/reviews/executable-evaluation/reviewer-3.md:## Verdict: REJECT
src/translationBench/public_datasets/breakthrough_findings/reviews/executable-evaluation/reviewer-1.md:## Verdict: REJECT
```

## Result

The analysis is reproducible, parses, and passes formatting. Each of the three
candidates received three REJECT verdicts. No benchmark-backed breakthrough is
claimed.
