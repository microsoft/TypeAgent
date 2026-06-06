# memory-eval

An LLM-judge benchmark harness for the **REM** (Recall Engram Memory) system.

It mirrors the methodology of the .NET KnowPro benchmark
(`dotnet/typeagent/examples/knowProConsole/Benchmarking`):

1. **Generate** questions (with reference answers) from a transcript, or use a
   curated set.
2. **Ingest** the transcript into REM and **answer** each question.
3. **Grade** each answer `correct` / `incorrect` / `partial` with an LLM judge.
4. **Report** an aggregate plus per-category and per-difficulty breakdown.

This is a **live** example — it requires API keys (configure
`config.local.yaml` or `.env` at the `ts/` root).

## Build

```bash
pnpm run build memory-eval
# or, from this directory:
pnpm exec tsc -b
```

## Usage

Generate a question file from a transcript:

```bash
node ./dist/main.js generate \
  --transcript ../../packages/knowPro/test/data/Episode_53_AdrianTchaikovsky.txt \
  --out episode53.questions.json \
  --count 30
```

Run the benchmark against REM:

```bash
# Curated questions (reused Episode 53 queries + hand-authored questions)
node ./dist/main.js run \
  --transcript ../../packages/knowPro/test/data/Episode_53_AdrianTchaikovsky.txt \
  --curated

# Generated questions from a file
node ./dist/main.js run \
  --transcript ../../packages/knowPro/test/data/Episode_53_AdrianTchaikovsky.txt \
  --questions episode53.questions.json

# Both, plus 10 freshly generated questions, capped at 20 total, saving results
node ./dist/main.js run \
  --transcript ../../packages/knowPro/test/data/Episode_53_AdrianTchaikovsky.txt \
  --curated --generate 10 --maxQuestions 20 --out results.json
```

## Question sources

- `--questions <file>`: a JSON file (`{ questions: [...] }`) from `generate`.
- `--curated`: the built-in set in `src/curatedQuestions.ts`, which combines the
  natural-language query strings reused from `Episode_53_nlpQuery.txt` with
  hand-authored questions. Reference answers that are not hand-authored are
  derived from the transcript by a closed-book oracle pass.
- `--generate N`: generate N fresh questions with the judge model.

## Adding KnowPro (later)

The harness drives any implementation of the `MemorySystem` interface
(`src/remRunner.ts`). A `KnowProSystem` adapter that loads the prebuilt
`Episode_53_AdrianTchaikovsky_index_data.json` + `_index_embeddings.bin` can be
added and run side-by-side; the report already supports multiple systems.
