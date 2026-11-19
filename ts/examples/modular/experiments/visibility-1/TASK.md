# Task 9: shapeProcessor.ts

This folder holds everything you need for this task, and everything you
may read. The restrictions below are enforced, not only asked for.

- **Write:** `shapeProcessor.ts`, and your report in `REPORT.md`. Every other file
  is read-only and is checked unchanged afterward.
- **Your outputs may import only:** `geometry.ts`, `shape.ts`, `dataModel.ts`, `shapeModel.ts`, `events.ts`.
- **Compiled with:** the ES2022 library only, so no Node or browser APIs.
- **Not allowed in your outputs:** any, globalThis, eval, Function, require, dynamic import(), import.meta, declare, and triple-slash directives.
- **Commands:** `npm test`, `npm run typecheck`, `npm run check`. No others will run.
  `npm test` lints your outputs before running the tests; `npm run check`
  runs every check the collector will run.
- **Read-only files here:** `canvas.ts`, `color.ts`, `color.vocab.ts`, `dataModel.ts`, `dataModel.vocab.ts`, `events.ts`, `frames.ts`, `geometry.ts`, `geometry.vocab.ts`, `layout.ts`, `rules.ts`, `scenarios.ts`, `shape.ts`, `shape.vocab.ts`, `shapeModel.ts`, `shapeModel.vocab.ts`, `shapeView.ts`, `shapeView.vocab.ts`, `view.ts`, `view.vocab.ts`.
- **Run but not read:** the tests and their infrastructure (`circleskit.ts`, `distributorkit.ts`, `driver.ts`, `eventEmitter.contract.ts`, `eventkit.ts`, `messageProcessor.contract.ts`, `ruleCheck.ts`, `rules.gen.ts`, `scenario.contract.ts`, `shapeModel.contract.ts`, `shapeProcessor.test.ts`, `shapeView.contract.ts`, `shapeviewkit.ts`, `shapewriterkit.ts`, `testkit.ts`, `viewkit.ts`).
  `npm test` runs them; you can't open them. A failing test is named
  by the ID of the rule it checks (`Interface.member.slug`), and the
  rule's statement, in the interface file, is what to meet.

**What you may decide.** Only what the spec leaves open: anything under
"Left to the implementer", and details no rule or spec text addresses,
such as names, data layout and helper functions. You may not decide what
the spec means. If a rule or spec text can be read more than one way, if
two of them conflict, or if the spec doesn't say something your
implementation must get right, stop: don't pick a reading, and don't
finish the implementation. Read the rest of this task's rules and spec for
every other such question, so that the next attempt can have them all
settled, and write a stopped report.

**REPORT.md** starts with one line: `Status: done` or `Status: stopped`.

- **Done:** a `## Choices` section listing each choice you made that the
  spec left open, and where your header records it (AdditionalSemantics,
  Cost and so on), and a `## Notes` section for anything you found hard
  or needed to know that none of these files told you. A done report has
  no questions.
- **Stopped:** a `## Questions` section. For each question: the file and
  rule ID or spec text; what is ambiguous, inconsistent or missing; the
  readings you see, with a concrete case where they differ; and what you
  need to be told. Your outputs are not collected, so they may be missing
  or partial.

## Rules for every implementation

`task.ts` turns each numbered section with an **Imports** field into a
generation task, and enforces these rules rather than only stating them. A section's fields: **Outputs** (default: the
file in its heading; "(header only)" means only the leading comment may
change), **Imports** (the only files the outputs may import), and
**Binds** (`node` or `dom`; default neither, so only the ES2022 library),
**Hidden** (files the task must not read, such as the reference
implementation of its own part; `task.ts` refuses to make a workspace
whose reads include one), and **Held** (why the task may not run yet,
such as a round the human hasn't reviewed; `task.ts` leaves it out of the
waves and refuses to make it, and only the human removes the field).

- **Imports:** only the files listed for that implementation. Use `import type`
  for interfaces. Relative imports use the `.ts` extension. No npm packages.
  Scripts (below) may also use Node built-ins (`node:*`); implementations
  may not.
- **No dependency on `rules.ts` or the `*.vocab.ts` files.** They hold
  reference definitions for tests. Implementations don't import them.
- **Header:** each file starts with a comment that has these fields:

  ```ts
  /**
   * <Name> implements <Interface>.
   *
   * How: <one or two sentences>
   * Choose when: <when to pick this implementation over others>
   * Cost: <time and allocation of the main operations>
   * AdditionalSemantics: <behavior allowed by the interface but not required by it, or "none">
   * Parts: <internal components that could become interfaces of their own, or "none">
   * Imports: <files imported>
   */
  ```

  A **script** is a file that npm runs and that implements no interface,
  such as a benchmark. Its header has these fields:

  ```ts
  /**
   * <Name> is a script: <what it is for>.
   *
   * How: <one or two sentences>
   * Run: <the npm command, and roughly how long it takes>
   * Imports: <files and Node built-ins imported>
   */
  ```

- **Measured numbers** in headers are ratios and crossover points (for
  example "10x faster inRect at 1,000 shapes; faster from about 100"), each
  naming the script that measures it. Absolute times depend on the machine
  and belong in the script's output, not in headers. Ratios move between
  processes, so give each as the range over several runs of the script.

- **Done** means `npm test` passes and `npm run typecheck` reports no errors.
  Don't change the contract tests (`*.contract.ts`), the `*.test.ts` files,
  the interface files, `rules.ts` or the `*.vocab.ts` files.
- **Decide only what the spec leaves open.** That is anything under "Left
  to the implementer", and details no rule or spec text addresses. Never
  decide what the spec means: when a rule or spec text can be read more
  than one way, conflicts with another, or leaves out something the
  implementation must get right, stop, list every such question you can
  find in the task, and report them instead of finishing. `TASK.md` gives
  the report's form.

## 9. `shapeProcessor.ts`

- **Exports:** `export class ShapeProcessor implements ShapeMessageProcessor`
  with the constructor `constructor(clientId: string, writer: ShapeCollectionWriter)`.
- **Hidden:** `shapeprocessorkit.ts`, `scenariokit.ts`, `adversaries/_shapeModel.ts`
- **Imports:** `geometry.ts`, `shape.ts`, `dataModel.ts`, `shapeModel.ts`, `events.ts`
- **Approach:**
  - `local.enqueue` stamps the operation (`MessageProcessor.stamps`),
    queues it, and returns a copy. `remote.enqueue` queues the operation and
    returns a copy of it. Both follow `OperationSink.enqueue.own-copy`, and
    neither applies anything.
  - `process` applies what is queued, through the writer, and is the only
    thing that calls the writer's `add` and `remove`.
  - A local add goes on top. A remote add goes directly below the lowest
    shape of a pending local add, or on top if none is pending: the order
    `ShapeMessageProcessor` describes comes to this. Keep track of that
    lowest pending shape rather than searching for it. A remove calls the
    writer's `remove` once with the listed IDs. A clear removes, in one
    call, the present shapes whose adds it knew.
  - The acknowledgment of a local operation records its seq in the
    processor's own state, and applies nothing. Operations are never
    changed.
  - Each client's operations are sequenced in clientSeq order
    (`MessageProcessor.client-order`), so a client's seqs grow with its
    clientSeqs.
  - `model` is a read-only facet of the writer: an object with only
    `ShapeCollection`'s members, delegating to the writer. Its `on` and
    `off` return the facet itself, not what the writer's return
    (`ShapeMessageProcessor.read-facet`). Never the writer itself.
  - The writer starts empty and belongs to the processor from then on.
  - `logOperations` (`OperationLogging` in `dataModel.ts`) is an
    `EventEmitter` of the processor's own, with Node's behavior
    (`events.ts`). `process` emits `applied` once for each operation it
    applies, acknowledgments included, after the operation's effect is
    in the writer and the writer has emitted its change: a local
    operation as `local.enqueue` returned it, a remote one as it was
    enqueued (`MessageProcessor.process.logs-each`, `local-order`,
    `remote-order`, `ShapeMessageProcessor.ack-keeps-z`, `one-change`).
- **Decided behavior:**
  - `newShapeId` returns `` `${clientId}#${n}` ``, with n counting from 0
    on each processor. The counter follows the last `#`, so IDs from
    different clientIds never collide, whatever characters they contain.
  - `process` never schedules itself, and nothing else in the class does
    (`MessageProcessor.passive`).
  - `process` applies the local queue first, then the remote queue, and
    repeats until both are empty. So a local operation is always applied
    before its acknowledgment, which can only be enqueued after it.
- **Costs** (`ShapeMessageProcessor.log-amortized`): `process` takes
  amortized logarithmic time per operation, plus time in proportion to
  the shapes a clear removes. That holds for every operation, removes
  included, whether or not a workload measures it: no step may take time
  in proportion to the shapes present, such as splicing an array of
  them; `local.enqueue`, `remote.enqueue` and
  `newShapeId` take constant time, apart from copying the operation.
- **Left to the implementer:** how pending operations and each shape's add
  are kept.
- **Contract:** `shapeModel.contract.ts` (`shapeMessageProcessorContract`,
  which also runs `messageProcessor.contract.ts`), wired in
  `shapeProcessor.test.ts` over `RefShapeWriter` (`shapewriterkit.ts`). The
  same file runs the scenarios (`scenarios.ts`) with this processor and
  references for every other part. `shapeModel.integration.test.ts`, which
  is not part of this task, runs it over `MapShapeCollection`.
