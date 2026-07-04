# Update Coordination — Implementation Decisions Log

> Running log of decisions made **during implementation** that are **not specified in** or **change**
> the design ([UPDATE_COORDINATION.md](./UPDATE_COORDINATION.md)) or the
> [UPDATE_COORDINATION_EXECUTION_PLAN.md](./UPDATE_COORDINATION_EXECUTION_PLAN.md).
> Append a new entry whenever you choose something the design did not pin down, or deviate from what it says.
> Keep entries short. If a decision invalidates the design, also update UPDATE_COORDINATION.md and note it here.
>
> Distinct from [UPDATE_COORDINATION_DEFERRED_LOG.md](./UPDATE_COORDINATION_DEFERRED_LOG.md): that log
> records gate findings / test gaps deliberately **not addressed**; this log records design-level choices
> **made** during implementation.

## How to use

- Add an entry the moment you make the call — don't batch.
- Cross-reference the design section (e.g. §5.5, §5.7) the entry relates to.
- Mark each entry's relationship: **Unspecified** (design was silent) or **Deviation** (design said otherwise).
- If a deviation is later ratified into the design, link the UPDATE_COORDINATION.md change.

## Entry format

```
### YYYY-MM-DD — <short title>
- **Milestone / item:** M_ / _._
- **Type:** Unspecified | Deviation
- **Design ref:** §_ (or "none")
- **Decision:** what was chosen.
- **Rationale:** why.
- **Design updated?** yes (link) | no (why not / follow-up)
```

---

## Entries

_None yet — add the first entry when Milestone 1 implementation begins._
