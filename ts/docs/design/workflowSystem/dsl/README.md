# Workflow DSL Design

Design documentation for the workflow DSL: the authoring surface that
compiles to the [workflow IR](../ir/ir-v1.md).

## Reading order

1. **[dsl-v1.md](dsl-v1.md)** - the v1 DSL design. Syntax, lowering
   rules, scope model, and the relationship to IR assumptions.
2. **[decisions/0001-language-style.md](decisions/0001-language-style.md)** -
   why the imperative TypeScript-like style was chosen over alternatives.

## Prerequisites

Before reading this component's docs, be familiar with:

- [principles/design-principles.md](../principles/design-principles.md) (P1-P5)
- [ir/ir-v1.md](../ir/ir-v1.md) (the compile target)
- [ir/dsl-assumptions.md](../ir/dsl-assumptions.md) (assumptions baked
  into v1 that this DSL must confirm or refute)
