# Workflow System Design

Design documentation for the workflow execution engine and its IR (workflow IR).

## Reading order

If you're new here, read in this order:

1. **[principles/design-principles.md](principles/design-principles.md)** - the five design principles (P1-P5) that govern the entire design. Defines the testable properties the system must have.
2. **[principles/principle-gaps.md](principles/principle-gaps.md)** - areas the principles permit but don't drive. Records gaps that have been closed and ones still open.
3. **[ir/ir-v1.md](ir/ir-v1.md)** - the v1 IR. The single authoritative description of the workflow document format, validation rules, and execution semantics.
4. **[ir/decisions/](ir/decisions/)** - per-decision records for the IR (one focused doc per significant choice).
5. **[ir/post-v1/](ir/post-v1/)** - sketches of IR features deferred past v1.

## Layout

```
docs/design/workflowSystem/
├── README.md                          (this file)
├── principles/                        cross-component, govern everything
│   ├── design-principles.md
│   └── principle-gaps.md
├── ir/                              the IR contract (component: ir)
│   ├── ir-v1.md                     authoritative v1 IR
│   ├── decisions/                     numbered design records (0001-, 0002-, ...)
│   └── post-v1/                       deferred IR features
├── engineering/                       cross-component plan, milestones, packaging
└── archive/                           pre-cleanroom drafts, preserved for context
```

Other components (engine, tasks, observability, persistence, security, dsl,
tooling, integration, evolution) will get their own folders when concrete
design work begins. Each will follow the same internal pattern as `ir/`:
a top-level doc plus optional `decisions/` and `post-v1/` subfolders.

## Taxonomy: the 2-axis grid

The directory layout encodes two orthogonal axes:

- **Component** (top-level folders): which sub-system the doc is about. Today only the IR is deeply designed; other components are placeholders or empty.
- **Genre** (within each component): what kind of doc it is - an authoritative description (`ir-v1.md`, `plugin-api.md`, ...), a numbered decision record (`decisions/NNNN-*.md`), or a forward-looking sketch (`post-v1/*.md`).

Cross-component concerns live at the top level: `principles/` (govern all components) and `engineering/` (milestones, packages, integration plan).

## Status conventions

Each doc under `ir/`, `engineering/`, and any future component folder carries a status header:

- `Adopted (v1)` - currently authoritative.
- `Open` - still being decided.
- `Superseded by [link]` - replaced; see successor.
- `Post-v1 sketch` - deferred but recorded.
- `ARCHIVED` - kept for historical context only; do not rely on.

## Contributing a new doc

- **A new design choice for an existing component:** add a numbered file under `<component>/decisions/`. Use [ir/decisions/0001-bound-outputs.md](ir/decisions/0001-bound-outputs.md) as the template.
- **A new component design:** create the component folder with a `README.md` (overview + reading order) and the first authoritative doc.
- **A forward-looking sketch:** put it under `<component>/post-v1/`.
- **A working analysis whose conclusion will land elsewhere:** put it next to the docs it informs; once the conclusion is folded in, archive the working notes.

## See also

- [archive/README.md](archive/README.md) - what's in the archive and what superseded each archived doc.
