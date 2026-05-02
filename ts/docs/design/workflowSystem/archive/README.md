# Archive

Status: Frozen. Preserved for historical context. Do not rely on.

These documents predate the clean-room redesign that produced
[../ir/ir-v1.md](../ir/ir-v1.md) and the sharpened
[../principles/design-principles.md](../principles/design-principles.md).
Their vocabulary (`inputMap`, `outputMap`, `loopVars`, `nodes.X.output`)
was replaced by the v1 spec's vocabulary (`bind`, `$from`, `state`,
`outputs`). Many "open questions" they record are now closed in v1; some
remain genuinely open and have been carried forward.

## Files

| File                                                           | What it was                                                    | Superseded by                                                                                         | Still-live content                                                                                                                                               |
| -------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [plan.md](plan.md)                                             | Engineering plan v0.5 (goals, packages, milestones, IR sketch) | IR sketch superseded by [../ir/ir-v1.md](../ir/ir-v1.md)                                      | §1 Goals, §2 Non-Goals, §4 Architecture (packages), §6 Task Plugin API. To be distilled into engineering/ and tasks/ when those components get real design work. |
| [loops-dataflow-controlflow.md](loops-dataflow-controlflow.md) | First structured design for loops, data flow, control flow     | [../ir/ir-v1.md](../ir/ir-v1.md) §3.7 (loops), §3.2-§3.4 (references)                         | None. The cleanroom redesign covered everything.                                                                                                                 |
| [design-decisions.md](design-decisions.md)                     | Per-decision log against the principles                        | Most decisions folded into [../ir/ir-v1.md](../ir/ir-v1.md) §8 and validated by the cleanroom | "Optional references" analysis (now in spec §3.4); "Node identity" open question (still pending)                                                                 |

## Why kept

- **Decision archaeology.** Useful when a future change asks "why is X this way?" - the answer often lives in the analysis that drove the cleanroom.
- **Pattern library.** Some of the principle-by-principle mechanism analyses in `design-decisions.md` are good models for how to evaluate a new design choice against P1-P5.
- **Promised distillation.** A few sections (Task Plugin API in `plan.md`, Node identity in `design-decisions.md`) need a proper home when their respective components (`tasks/`, `evolution/`) get designed. Until then they live here.
