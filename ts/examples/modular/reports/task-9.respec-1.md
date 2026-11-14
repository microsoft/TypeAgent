# Task 9 goes back: the operation log (2026-11-13)

The human agreed to an observation interface as part of the formal-design
pilot (`pilot-shapeModel.md`):

- Every `MessageProcessor` has `logOperations`, written as a separate
  interface, `OperationLogging` in `dataModel.ts`. It emits `applied` for
  each operation as the processor applies it.
- With it, `ShapeMessageProcessor.ack-keeps-z` and `one-change` have exact
  expressions, per operation. `MessageProcessor.local-order` and
  `remote-order` are now `@ensures` with expressions rather than
  `@abstract`, and `MessageProcessor.process.logs-each` is new.

`shapeProcessor.ts` lacks the member, so task 9's spec gains a bullet
for it and the task runs again. The human approved the rerun.
