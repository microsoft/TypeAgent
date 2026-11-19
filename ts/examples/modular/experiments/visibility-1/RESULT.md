# Visibility experiment 1: tests runnable, not readable

Date: 2026-11-18. The question is in `../../tool/elements.md`
("Visibility to the implementer").

## Setup

- Task 9.2 (`shapeProcessor.ts`, Sonnet), starting from an empty output,
  made with `node task.ts make 9.2 --tests runnable`.
- The agent could read the design files: the interfaces, their
  vocabularies, `rules.ts` and `scenarios.ts`. Its policy denied reading
  the 16 harness files in the workspace (contracts, kits, test wiring,
  `ruleCheck.ts`, `rules.gen.ts`); `npm test` and `npm run check` still
  ran them. `TASK.md` (kept here) said so.
- Before the run, a Haiku probe under the same policy confirmed that Read
  and Grep are refused on those files, and that a grep over the folder
  skips them.
- Not collected: the accepted 9.2 in `alternates/` is unchanged. The
  output and report are kept here.

## Result

| | This run | Earlier 9.2 runs, tests readable (4, Sonnet) |
|---|---|---|
| Cost | $1.30 | $1.49 to $2.16 |
| Turns | 30 | 25 to 36 |
| Minutes | 10.7 | 11.1 to 15.7 |
| Checks | pass | pass (the second-to-last sent back in 2b for its budget) |

- The agent never tried to read a denied file. Its four refused tool
  calls were Bash commands prefixed with `cd`, which the command gate
  rejects, and a Glob outside the workspace.
- `bench.ts` run against its output: processor ratios 2.34 (adds), 4.13
  (removes), 0.66 (clears that remove nothing), against a limit of 16.
- Its report's choices are the kind the spec leaves open. It found what
  the read facet needed from the vocabulary (`onlyMembers` in
  `shapeModel.vocab.ts`), not from the tests.

## What it shows, and what it doesn't

- For this task, hiding the tests cost nothing measurable: cost, turns
  and time are at or below the earlier runs.
- One run on one task. Task 9's spec has been refined by four earlier
  attempts and their reviews, so it may be easier than a fresh spec; and
  without the earlier runs' transcripts, it isn't known how much those
  agents read the contracts.
- Not reviewed in full (2b); only its report and budgets were read.
- What it could read is known; what it opened isn't. The run's saved
  result keeps the final message and the refused tool calls, not a
  transcript.
- It could still read a lot of prose: `TASK.md`'s 1,400 words, including
  task 9's Approach and Costs text, which distill four earlier attempts
  and their reviews and come close to prescribing the algorithm; the
  doc comments and rule headlines in the design files; `.task/task.ts`,
  which wasn't denied; and `npm test`'s failure output, which carries
  the harness's assertion messages. That prose, more than the tests, is
  likely why hiding the tests cost nothing here.

A stronger test would be a task whose spec hasn't been refined by
earlier runs, run both ways on the same model.
