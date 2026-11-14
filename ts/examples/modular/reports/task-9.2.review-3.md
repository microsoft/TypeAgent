Status: reviewed

Phase 2b review of task 9.2's attempt after the operation log (`alternates/shapeProcessor.run-2.ts`, Sonnet), sent back by `reports/task-9.respec-1.md`. Drafted by the design agent; the human asked for the review.

## Choices

- **respecify** The sorted arrays break `ShapeMessageProcessor.log-amortized`: a remove splices each listed shape out of `globalAcked` and a client's list, and a clear splices from the front, each taking time in proportion to the shapes present. Measured on 2026-11-13, removes take 28.4 times as long per operation at 100,000 shapes as at 1,000 (task 9's take 1.7 times), against a limit of 16. No workload measures removes, so the bench couldn't catch it; under the agreed budget principle, passing the measurement isn't enough. The Costs field now says no step may take time in proportion to the shapes present.
- **open** What a clear knew, found as prefixes by refSeq and by the author's clientSeq: correct, and derived from the rules (the cost of its structures is the choice above).
- **open** A clear that knows no shape doesn't call the writer's `remove`.
- **open** The log is a small emitter written in the file.
- **open** The model facet is an object literal with exactly `ShapeCollection`'s members.
- **open** `newShapeId` as the spec decides.

## Notes

- **spec fix** That a client's seqs grow with its clientSeqs follows from `MessageProcessor.client-order` and `remote-seq`, but nothing said so; task 9's Approach now does.
- **decision** The processor's workloads (`processorWorkloads`) have no removes, which is how this attempt's cost went unmeasured. Adding one, such as "remote removes of random present shapes", is a new design term, so it is for the human to agree to.
