# Verification evidence

## Goal

Check whether the saved Seal-Tools and DroidCall artifacts support a large,
causal TypeAgent improvement. The final resources are `analyze.mjs`, its JSON
report, and the nine independent review files.

## Scope

No full benchmark was rerun. Verification rescanned the eight saved 1,000-row
DroidCall results and reran the existing ten-row dependency probe analysis.
The probe itself was not regenerated.

## Environment

```text
$ rtk proxy node --version
v24.14.1
```

The checks used local files only. They needed no credentials or network calls.

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

Read the generated report and check its main invariants:

```text
$ rtk proxy jq -e '.fullRun.run == {rows: 1000, configurations: 8, distinctModels: 7, selection: "independent multi-action DroidCall rows"} and .coverage.combined.dependentRows == 1179 and (.dependentProbe | length) == 1' src/translationBench/public_datasets/breakthrough_findings/evidence/cross-dataset-analysis.json
true
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
claimed. Every command above exited with status 0.
