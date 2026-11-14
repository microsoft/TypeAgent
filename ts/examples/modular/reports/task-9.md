Status: done

The workspace seeded `shapeProcessor.ts` with the implementation collected
before `OperationLogging` was added to `dataModel.ts`, so this round's work was
the log: `logOperations`, an `EventEmitter` of the processor's own, and an
`applied` event per operation `process` applies. Everything else — the stamps,
the two queues, the z-order bookkeeping, the read-only facet and the clear —
needed no change, and `npm test` (58 tests) and `npm run typecheck` pass.

## Choices

- **An emitter of one event, written in the file.** The task's imports don't
  include `eventkit.ts`, so `logOperations` is a private `OperationLog` class
  here. It holds one list of registrations, since `applied` is the only event
  `OperationLogEvents` has, and it ignores the event name it is given, which
  can only be `"applied"` under the types. `on` and `off` replace the list
  rather than change it, which is what gives `EventEmitter.snapshot` and
  `off`'s `removes-one` Node's behavior. Recorded under Parts, which names the
  log as a part another producer of events could keep.
- **What the `applied` event carries.** The processor's own copy of the
  operation: for a local one the object it stamped, which is equal to the copy
  `local.enqueue` returned, and for a remote one the copy `remote.enqueue`
  made of what it was given. The spec asks for the operation "as
  `local.enqueue` returned it" and "as it was enqueued", which fixes the
  values but not which object carries them. A listener that changed the object
  it gets would change nothing else, since the processor drops the operation
  once it is applied and never changes one itself. Recorded under
  AdditionalSemantics, with the note that `applied` is the log's only event.
- **Where the emit goes.** `applyLocal` and `applyRemote` emit last, after the
  writer call they make, so the shapes already show the whole effect and the
  writer has emitted its change; an acknowledgment, which calls the writer not
  at all, emits as soon as it has recorded its seq. Recorded in the header's
  How, and in the comments on those two methods.
- **One field, two names.** `logOperations` is typed as the `EventEmitter` the
  interface asks for, and a private field holds the same object as an
  `OperationLog`, so `emit` is the processor's alone. Nothing records this: it
  is a detail of the data layout, which the task leaves to the implementer.

Choices the collected implementation made, which this round kept and which its
header still records, are not repeated here.

## Notes

- `ShapeMessageProcessor.one-change` and `ack-keeps-z` are checked through
  `steps` (`dataModel.vocab.ts`), which reads the model at each event of the
  `process` call and asks that every `model.change` fall between two `applied`
  events, with the model the same at the change and at the `applied` that
  follows it. So the log isn't only a record: the order of the emits is what
  makes those two rules checkable, and emitting `applied` before the writer
  call, or emitting all of them at the end of `process`, would break them even
  though the shapes would end up the same. The `Approach` text says this
  ("after the operation's effect is in the writer and the writer has emitted
  its change"); the rules alone don't, and I had to read `steps` to see it.
- `observe` (`ruleCheck.ts`) reads `logOperations` off the raw processor and
  calls `on` before any operation is applied, and `ShapeMessageProcessor`'s
  own `read-facet` rule doesn't reach the log, so the log has no restriction
  on its properties the way `model` does. `emit` as a public method of
  `OperationLog` is therefore safe; it is only out of reach through the
  `EventEmitter` type that `logOperations` has.
- The header's `Cost` field keeps the measured numbers from the round that
  collected this file. I could not re-measure them: `bench.ts` isn't among
  this workspace's files and `npm run bench` isn't one of the commands this
  task may run. The log adds one emit per operation, which is constant work
  and doesn't move a ratio between 1,000 and 100,000 shapes, so the numbers
  should still hold — but they are carried over, not checked here, and the
  `Cost` field now names the applied event alongside the writer call.
