# IR validation: hand-written scenario corpus

Status: Open. Pre-v1.

## Why this folder exists

The v1 IR design ([../ir-v1.md](../ir-v1.md)) is internally consistent and
well-grounded in the principles ([../../principles/design-principles.md](../../principles/design-principles.md)),
but every decision in the `decisions/` records has so far been judged
against other decisions in the same document. The scenario inventory
in [`~/doc/workflow/wider-scope.md`](~/doc/workflow/wider-scope.md) §1
has never been used to apply external pressure to the design.

This folder closes that gap. Each file picks one scenario from that
inventory, hand-writes the v1 IR for it, and records what hurt.

## What each scenario file contains

A scenario file is structured to keep the IR honest, not to advertise it:

1. **Scenario** - one paragraph from the `wider-scope.md` inventory,
   stated as a user/developer story with concrete inputs and expected
   outputs. No design language.
2. **Task inventory** - the registered task implementations the IR will
   reference, with their `inputSchema` / `outputSchema`. Made up where
   needed; these are not commitments to a real task catalog.
3. **IR** - the full JSON IR, hand-authored, conforming to v1 as
   currently specified. No DSL, no codegen. The IR is what a writer
   would have to produce today.
4. **What hurt** - friction points encountered while writing the IR.
   Categorized as:
   - **Verbosity tax** - things that were tedious but worked (§1.2 paying off as expected).
   - **Surprises** - the IR forced a structure that was not the obvious one.
   - **Gaps** - things the scenario needs that v1 cannot express.
   - **Decision pressure** - specific §8 decisions or `decisions/` records the scenario stresses.
5. **DSL hint** - a paragraph or sketch of what the DSL surface for
   this scenario would look like, for free. The IR does not have to
   solve this, but the gap between "what I wrote" and "what I would
   want to write" is data for the future DSL.
6. **Engine implications** - what this IR forces the engine to do that
   the §5.7 conformance bar may or may not already cover.

## How to read this folder

Each scenario stands alone. Read 2-3 in any order before drawing
conclusions. After enough scenarios accumulate (target: 5), a synthesis
doc here will collect cross-scenario findings and feed back into
[../decisions/](../decisions/) and [../post-v1/](../post-v1/).

## Scenario index

| File                                       | Source              | Status  |
| ------------------------------------------ | ------------------- | ------- |
| [a4-morning-brief.md](a4-morning-brief.md) | `wider-scope.md` A4 | Drafted |
| [b1-wire-apis.md](b1-wire-apis.md)         | `wider-scope.md` B1 | Drafted |

## Non-goals

- Not exhaustive. Five well-chosen scenarios beat fifty thin ones.
- Not a regression suite. These are design probes, not engine tests.
  Engine tests live elsewhere when the engine exists.
- Not a v1 commitment. A scenario that cannot be expressed in v1 is a
  finding, not a defect to be fixed inside v1.
