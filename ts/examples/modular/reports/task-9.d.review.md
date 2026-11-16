Status: reviewed

Phase 3b review of task 9's distinguishing tests after both runs were redone for the operation log, drafted by the design agent for the human to decide each item. A was run 1 (Opus), B run 2 (Sonnet).

## Tests

- **freedom** A local remove whose `ids` array the caller changes after enqueuing: A copied it, B (and the reference) queued the caller's array. The test changes an enqueued item, so no conforming caller sees the difference. `Operation`'s "operations are never changed" said so only in prose; decided (the human, 2026-11-16): it is the caller's obligation, now the rule `MessageProcessor.items-unchanged`, checked by comparing each enqueue call's arguments with the copy the history keeps (`Call.given` against `Call.args` in `rules.ts`).
- **freedom** The same on the remote queue, under the same rule.
- **freedom** `applied` reports the object given to `remote.enqueue` (B) or an equal copy (A). "As it was enqueued" fixes the values, not the object.
- **freedom** The stamped operation's property order. `MessageProcessor.stamps` fixes which fields and their values.
- **freedom** The read facet's members are own (B) or inherited (A). `read-facet` allows either, on purpose.
- **freedom** The log's listeners are in a `#private` field (A) or an own property (B). No rule speaks of `logOperations`' properties; the previous review decided a forged log entry changes no shape and nothing reads the log.
- **freedom** Calling the facet's `on` detached from the facet. The interfaces describe method calls on the object; a detached call isn't one.

## Notes

- **nothing** The two agree on everything the rules settle, including writer calls, `below` after acknowledgments and removals, clears, the log's order and the stamps.
- **nothing** Their per-client lists differ only for adds applied out of `clientSeq` order, which `client-order` rules out.
- **nothing** The drain order differs only under reentrancy, which `not-reentrant` forbids.
- **nothing** The reference counts `clientSeq` from 1 and the runs from 0; `stamps` asks only that it grow.
