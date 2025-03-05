# Instructions for running evals

These instructions are biased towards Linux.
For Windows I may have to adjust some of the code
(especially shell commands).

For more about the design of evaluations, see `evals/design.md`.

This uses the running example of using the dispatcher package
as sample code.

We use `evals/eval-1` as the directory to hold all eval data.
(This happens to be the default built into the scripts.)

(Consider using a different directory -- we now have checked-in
data for both `eval-1` (`dispatcher`) and `eval-2` (spelunker),
so consider a higher number or a different prefix.

## 1. Copy source files to EVALDIR (`evals/eval-1`)

Assume the TypeAgent root is `~/TypeAgent`. Adjust to taste.

```shell
$ mkdir evals/eval-1
$ mkdir evals/eval-1/source
$ cp -r ~/TypeAgent/ts/packages/dispatcher evals/eval-1/source/
$ rm -rf evals/eval-1/source/dispatcher/{dist,node_modules}
$ rm -rf evals/eval-1/source/dispatcher/package.json
$
```

We delete `dist` and `node_mpdules` to save space (Spelunker ignores them).
We remove `package.json` since otherwise the Repo policy test fails.

Create `evals/eval-1/source/README.md` to explain the origin of the code
(notably the git commit ID from which the code was copied, and the path
of the code relative to TypeAgent).

## 2. Run Spelunker over the copied sources

NOTE: You must exit the CLI by hitting `^C`.

```shell
$ cd ~/TypeAgent/ts
$ pnpm run cli interactive
...
{{...}}> @config request spelunker
Natural langue request handling agent is set to 'spelunker'
{{<> SPELUNKER}}> .focus ~/TypeAgent/ts/packages/agents/spelunker/evals/eval-1/source/dispatcher
Focus set to /home/gvanrossum/TypeAgent/ts/packages/agents/spelunker/evals/eval-1/source/dispatcher
{{<> SPELUNKER}}> Summarize the codebase
...
(an enormous grinding of gears)
...
The codebase consists of various TypeScript files that define interfaces, functions, classes, and tests for a system that handles commands, agents, and translations. Here is a summary of the key components:
...
References: ...
{{<> SPELUNKER}}> ^C
 ELIFECYCLE  Command failed with exit code 130.
 ELIFECYCLE  Command failed with exit code 130.
$
```

This leaves the data in the database `~/.typeagent/agents/spelunker/codeSearchDatabase.db`

## 3. Initialize the eval database

You can do this multiple times, using `--overwrite`. (Without that flag,
it will create a new eval directory `eval-N`.) `--overwrite` preserves
the Questions and Scores tables, but recomputes the Hashes table, after
recopying the Files, Chunks and Blobs tables.
(It doesn't need the Embeddings and Summaries tables.)

```shell
$ python3 ./evals/src/evalsetup.py --overwrite
Prefix: /home/gvanrossum/TypeAgent/ts/packages/agents/spelunker/evals/eval-1/source/
Database: evals/eval-1/eval.db
...
(More logging)
...
$
```

## 4. Run the manual scoring tool

You have to score separately for every test question.
I recommend no more than 10 test questions
(you have to score 426 chunks for each question).

```shell
$ python3 evals/src/evalscore.py --question "Summarize the codebase"
```

The scoring tool repeatedly presents you with a chunk of text,
prompting you to enter `0` or `1` (or `y`/`n`) for each.

Chunks are colorized and piped through `less`;
if a chunk doesn't fit on the page you'll get to page through it.

## 5. Run an evaluation

TBD.

## 6. Where everything is

The `evals` directory under `spelunker` contains everything you need.

- `evals/src` contains the tools to run.
- Each separate evaluation (if you want to evaluate different codebases)
  lives in a separate subdirectory, e.g. `evals/eval-1`.
- Under `evals/eval-N` you find:
  - `eval.db` is the eval database; it contains all the eval data.
    - Tables `Files`, `Chunks`, `Blobs` are literal copies of
      the corresponding tables from the database used by the agent.
    - `Hashes` contains a mapping from chunks to hashes.
    - `Questions` contains the test questions.
    - `Scores` contains the scores for each test question.
  - `source` contains the source code of the codebase; for example:
    - `source/dispatcher` contains the (frozen) `dispatcher` package.
    - `source/README.md` describes the origin of the codebase.
