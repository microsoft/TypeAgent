Status: reviewed

Phase 2b review of task 9's third attempt (`shapeProcessor.ts`, Opus), sent back by `reports/task-9.respec-1.md` to add `logOperations` (`OperationLogging` in `dataModel.ts`). Drafted by the design agent; the human asked for the review.

## Choices

- **open** The log is a one-event emitter written in the file, since the task's imports don't include `eventkit.ts`; `on` and `off` replace its list, which gives Node's snapshot behavior.
- **open** `applied` carries the processor's own copy of the operation; the spec fixes its values, not which object carries them.
- **open** `applyLocal` and `applyRemote` emit last, after the writer call, and an acknowledgment as soon as its seq is recorded: what the spec asks.
- **open** One object under two fields, typed as `EventEmitter` for others and as the log class for the processor.

## Notes

- **spec fix** The rules alone didn't say that the log reports an operation after its change event; only `steps` and the Approach text did, so the agent had to read the vocabulary to find it. `one-change`'s expression always enforced it; its headline now says so.
- **nothing** The log has no facet rule like `read-facet`, so a holder that casts away the `EventEmitter` type can call `emit`. `read-facet` exists because the writer changes the shapes; a forged log entry changes no shape, and nothing the processor does reads its own log.
- **nothing** The carried-over Cost numbers were checked: `npm run bench` on 2026-11-13 gives writer ratios of 4.4 to 7.4 and processor ratios of 2.4 and 0.8, against a limit of 16.
