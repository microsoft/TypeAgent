# Design for a new, universal tool

## Functionality

- Interactive question answerer. You type the question and it prints
  the answer.
- Debugging helper. Can print various intermediate data structures
  on demand. Can change what gets printed interactively or with
  command-line flag.
- For each data structure there are several levels of debug output:
  0. Print nothing.
  1. Print the full data structure.
  2. Print a diff with the reference values.
  3. For final answers only, compare similarity with reference value,
     and print diff only if they are not very close.
- Compare intermediate data structures and results to reference values
  -- if the question is in the reference, of course.
- Run a list of questions from a JSON file and treat them like above.
- Inputs (pragmatically) -- we have formats for these already:
  - The "podcast" index (actually two files, one .json and one .bin).
  - A file with a list of questions and reference answers.
  - A file with a list of questions and reference intermediate values.

## Stages (phases) of the processing

- Stage one: LLM translates question to `SearchExpr`.
  This is still a source of mistakes.
- Stage two: `SearchQueryCompiler` translates `SearchExpr` to
  `list[SearchQueryExpr]`. There used to be bugs here but not any more.
- Stage three: Runs the query against the loaded index.
  This used to be buggy, now seems pretty solid.
- Stage four: Bundles up the query results and sends to LLM for
  answer generation. There are still some issues here, for exampple
  we don't protect against huge contexts, and the prompts could use
  some tweaking.

### Constraints

Due to the structure of the knowbot package, we can't stop after
any stage. Stages 1-3 are done by one function; stage 4 is a separate
function. We have some control over stages 1-3:

- We can skip stage 1 by supplying a precomputed `SearchExpr` instance.
- We can skip stages 1-2 by supplying a `list[SearchQueryExpr]`.
- We can skip stages 1-3 by calling stage 4 directly.
- We get the output of stages 1-2 by passing a debug context,
  and the output of stage 3 is returned by the function.
- We could also run just stage 1 or stages 1-2 by calling lower-level
  (or internal?) functions, maybe?

## Debug flags

Unfortunately the debug levels form a kind of matrix -- for each stage
we may have a different debug setting (depending on our focus).

Let's say we have a global `--debug` flag with the following values:

- `--debug none`: no output for any stage
- `--debug diff`: only print diff with reference for each stage
- `--debug full`: print full results of each stage

### Per-stage debug overrides

Then we can also separately have per-stage flags with the same values;
these override the default set by `--debug`:

- `--debug1`
- `--debug2`
- `--debug3`
- `--debug4`

(Would it be nicer if we had names for the stages instead of numbers?)

### Skippable stages

Some of these allow one extra value:

- `--debug1 skip`
- `--debug2 skip`

These indicate that the corresponding stage is simply skipped, and
its output is replaced by pre-computed intermediate results read from
a file (`--srfile`).

For regular interactive use, we'd have `--debug none --debug4 full`.
For batch comparison runs, we'd use `--debug diff`.

In interactive mode it must be possible to change these flags without
exiting the tool.

## How to start interactive or batch mode

Let's say interactive is the default mode. To run a batch of queries
automatically, use `--batch` -- this changes the default debug flags
to `--debug diff` and takes its questions from `--qafile`.

In interactive mode the default debug flags are set to
`--debug none --debug4 full`. The `--qafile` and `--srfile` arguments
are still used to support `--debug diff` etc.

### Sketch of the code for `--batch`

1. First we need to define `--debug` and `--debugN` to have `None`
   as the default value. E.g.
   ```py
   parser.add_argument("--debug", type=str, default=None,
                       help="Debug level: none, diff, full")
   # And ditto for `--debug1` etc.
   ```

2. Use `--debug` as the default for `--debugN`.
   ```py
   for key in "debug_1", "debug_2", "debug_3", "debug_4":
       if getattr(args, key) is None:
           setattr(args, key, args.debug)
   ```

3. Use presence/absence of `--batch` th set the final default:
   ```py
   for key in "debug_1", "debug_2", "debug_3", "debug_4":
       if getattr(args, key) is None:
           if args.batch:
               setattr(args, key, "diff")
           else:
               setattr(args, key, "full" if key == "debug_4" else "none")
   ```

## Main proram logic

There's a function that runs the entire pipeline (stages 1-4) and
prints the selected output (a debug variable for each stage).
This function must be `async` because most stages reach out to the
web, either to let an LLM do the work (stages 1, 4), or to use
embeddings for fuzzy matching. It prints to `sys.stdout`.

There is a `Context` object that is passed to this function providing
access to the conversation, the debug flags, and everything else.
However, the question to be answered is a string passed in explicitly.

After argument parsing, blah blah blah, we check the `--batch` flag.
If it's set, we enter a loop that iterates over all (or a subset) of
the Q/A pairs in the `--qafile`. For each pair it calls the above
function. It keeps some stats which are printed at the end.

If the `--batch` flag is not set, we enter an interactive loop that
prompts for a question from `sys.stdin` (with editing and history)
and then runs the above function to run the pipeline for this question.

The interactive loop catches most exceptions (but not `BaseException`s)
and returns to the prompt if it catches one, after printing a traceback.

The interactive function also supports some other types of input, e.g.
`@`-prefixed commands. It responds to EOF (`^D` or `^Z` per platform),
`^C`, and short commands like `q`, `quit`, `exit`, or `@quit` (etc.) by
exiting (with exit status 0 except for `^C`).

It also treats lines starting with `#` as comments which are ignored.

Because reading a line from `stdin` is blocking and has no `asyncio`
equivalent, the interactive loop runs each question in a separate
`asyncio.run()` call.

The interactive loop can also read from a file (if `stdin` is a file),
in which case it doesn't print interactiv prompts -- it just treats
each line in the file as a separate question or special command.
