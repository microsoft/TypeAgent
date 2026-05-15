# Visual Editor Exploration Plan

Status: **Plan.** Not yet started.

Related:

- [../dsl/dsl-v0.1.md](../dsl/dsl-v0.1.md) - the DSL this editor would surface
- [../ir/ir-v0.1.md](../ir/ir-v0.1.md) - the IR the DSL compiles to
- [vision.md (section 5.1)](~/doc/workflow/vision.md) - the visual
  canvas editor vision (targets IR directly)

---

## 1. The question

The vision doc (section 5.1) describes a visual canvas editor that
targets the IR directly: node-graph with palette + inspector, forms
auto-rendered from JSON Schema, binding-aware fields. That design
predates the DSL.

Now that a working DSL exists, a new question arises: **can a visual
editor be built on top of the DSL rather than (or in addition to) the
IR?** And if so, does that give us anything the IR-only approach
doesn't?

This plan defines the exploration work to answer that question.

---

## 2. Why this matters

The DSL and IR are two representations of the same workflow, but they
sit at different abstraction levels:

| Property           | DSL                            | IR                                  |
| ------------------ | ------------------------------ | ----------------------------------- |
| Abstraction level  | Intent (what the author meant) | Execution (what the engine needs)   |
| Control flow       | `for`, `while`, `if`, `try`    | Loop nodes, branch nodes, onError   |
| Variables          | Named, scoped, SSA-ish         | Flat node IDs + `$from` references  |
| Boilerplate        | Implicit (compiler generates)  | Explicit (index machinery, schemas) |
| Round-trip editing | Natural (text)                 | Fragile (many derived fields)       |
| LLM emittability   | High (TS in training data)     | Low (verbose, novel structure)      |

A visual editor built on the IR must hide the execution-level detail
(index counters, length nodes, compare nodes, check_done branches)
that the compiler generates. A visual editor built on the DSL gets
that compression for free.

---

## 3. Design space

Three candidate architectures, with trade-offs:

### 3.1 Option A: Visual editor over DSL source (DSL as source of truth)

The editor manipulates DSL source text. Visual actions (add node, wire
connection, set parameter) produce DSL edits. The compiler runs on
every change to produce the IR for validation and preview.

```
Visual UI  <-->  DSL source  -->  compile  -->  IR  -->  engine
```

**Pros:**

- Round-trip is trivial: DSL is the source of truth, same as text editing
- LLM-generated workflows and visual-edited workflows are the same artifact
- No second serialization format to maintain
- Undo/redo is text undo/redo
- Diff/merge uses standard text tools

**Cons:**

- Requires a DSL parser that preserves formatting (CST, not just AST)
  for non-destructive edits
- Complex control flow (nested if/else, try/catch inside while) is hard
  to represent visually without losing the DSL's imperative clarity
- Visual layout information (node positions, group boxes) has no home
  in DSL source - needs a sidecar file
- Compiler latency on every edit (likely acceptable given current speed)

**Key risk:** DSL syntax has structure (indentation, ordering,
semicolons) that a visual editor shouldn't expose. Generating clean
DSL from visual operations requires either a pretty-printer or a
structured editing model.

### 3.2 Option B: Visual editor over IR (IR as source of truth)

The original vision doc approach. The editor manipulates IR JSON
directly. Visual actions produce IR mutations.

```
Visual UI  <-->  IR JSON  -->  engine
```

**Pros:**

- Direct: no compilation step between edit and execution
- The IR is already a graph, so visual layout is natural
- All IR features are expressible (no DSL limitations)
- Round-trip with the engine is exact

**Cons:**

- IR verbosity: the editor must hide generated infrastructure
  (index counters, schema restatements, next threading)
- No text-friendly authoring: hand-editing IR is the "Option D"
  shorthand story from the language style decision
- LLM generation targets the DSL, so NL-authored workflows need a
  compile step before the visual editor can open them
- Diff/merge on IR JSON is noisy

### 3.3 Option C: Dual representation (DSL + IR, bidirectional)

The editor maintains both representations. Visual edits go to the DSL
(compiled to IR for execution); the IR is read-only from the editor's
perspective. A decompiler (IR -> DSL) handles the reverse direction
for workflows that arrive as IR (e.g., from another tool).

```
Visual UI  <-->  DSL source  -->  compile  -->  IR  -->  engine
                                    ^
                                    |
                              decompile (IR -> DSL, lossy)
```

**Pros:**

- Best of both: DSL for authoring, IR for execution
- LLM and visual workflows share the same source format
- Decompiler only needed for import, not for the edit loop

**Cons:**

- Decompiler is hard: IR -> DSL is lossy (variable names,
  control flow structure, formatting are not in the IR)
- Two representations to keep consistent
- Complexity budget is high

---

## 4. Exploration milestones

### Milestone 1: DSL structure analysis (1-2 days)

**Goal:** Determine whether the DSL's AST carries enough structure
for a visual editor to manipulate without dropping to raw text.

Tasks:

- [ ] Enumerate the visual operations a minimal editor needs (add task,
      delete task, wire output to input, set literal, add control flow
      block, reorder statements)
- [ ] For each operation, define the AST transformation required
- [ ] Identify which operations require CST (comment/whitespace
      preservation) vs. which can use AST + pretty-print
- [ ] Assess: is a pretty-printer sufficient, or is a CST mandatory
      for acceptable round-trip quality?

Deliverable: A table mapping visual operations to AST edits, with a
go/no-go on whether the current AST is sufficient.

### Milestone 2: Prototype - read-only visualization (2-3 days)

**Goal:** Render an existing `.wf` file as a visual graph to test
whether the DSL's structure maps well to a node-graph layout.

Tasks:

- [ ] Parse a `.wf` file to AST
- [ ] Walk the AST and extract a graph model: nodes (task calls),
      edges (data flow via variable references), groups (for/while/try
      blocks)
- [ ] Render the graph using a simple layout library (e.g., elkjs
      for auto-layout, rendered to SVG or Canvas)
- [ ] Evaluate: does the visual structure match the author's intent?
      Are the control flow blocks (for, while, try) visually clear?
      Does the graph capture the important relationships?

Deliverable: A standalone HTML page (or VS Code webview) that
visualizes d1-standup-prep and d8-summarize-url as node graphs.

### Milestone 3: Prototype - single edit operation (2-3 days)

**Goal:** Prove that a visual action can produce a valid DSL edit.

Tasks:

- [ ] Pick one operation: "add a task call after node X"
- [ ] Implement: click on the canvas to insert a task, select the
      task type from the palette, the editor generates a `let` statement
      and inserts it at the correct position in the DSL source
- [ ] Compile the modified DSL and verify the IR is valid
- [ ] Evaluate: was the edit clean? Did formatting survive?

Deliverable: Working prototype of one visual-to-DSL edit, with
assessment of the pretty-printer vs. CST question.

### Milestone 4: Architecture decision (1 day)

**Goal:** Choose Option A, B, or C based on milestone findings.

Tasks:

- [ ] Review milestone 1-3 results
- [ ] Write an architecture decision record (ADR) with the choice
      and rationale
- [ ] If Option A: define the CST/pretty-printer requirements
- [ ] If Option C: scope the decompiler work
- [ ] Identify what DSL features are missing for visual editing
      (e.g., layout metadata, grouping hints)

Deliverable: ADR in `decisions/`.

---

## 5. Questions to answer during exploration

### 5.1 Representation

1. Does the DSL AST carry enough information for visual manipulation,
   or does the editor need a richer intermediate model?
2. Where does visual layout metadata live (node positions, group
   collapse state)? Sidecar JSON? DSL comments? Separate file?
3. Can the DSL's scope model (lexical, block-structured) map to a
   visual scope model (nested containers/groups)?

### 5.2 Control flow visualization

4. How should `while(true)` loops render? A box with a loop-back
   arrow? A container with break/continue ports?
5. How should `try`/`catch` render? Two side-by-side containers?
   An error-path annotation on each task?
6. How should `if`/`else` render? A diamond splitter with two
   branches? A conditional container?
7. Does the visual representation of control flow suggest different
   DSL primitives would be easier to visualize?

### 5.3 Round-trip

8. If the user edits DSL source in a text editor, can the visual
   editor re-open it without layout disruption?
9. If the visual editor produces DSL source, is it readable and
   diffable?
10. Can the visual editor and text editor be open simultaneously
    on the same file (split view)?

### 5.4 Scope and feasibility

11. What is the minimum viable visual editor? (Read-only graph view?
    Task insertion only? Full graph editing?)
12. Can we reuse an existing graph editor library (React Flow,
    xyflow, Rete.js, elkjs) or do we need custom rendering?
13. What is the hosting target? VS Code webview? Standalone web
    app? Both?

---

## 6. Out of scope for this exploration

- NL authoring (the workflow editor agent from vision.md section 5.3)
- Palette/registry design (which tasks are available)
- Execution integration (run button, step debugger)
- Multi-file workflows
- Collaboration / sharing
- Performance at scale (>50 nodes)

These are real concerns but they don't affect the core feasibility
question: can the DSL serve as the backing model for visual editing?

---

## 7. Success criteria

The exploration succeeds if it produces:

1. A clear architectural recommendation (A, B, or C) with evidence
2. A working read-only prototype that renders both example workflows
3. A working single-edit prototype that proves DSL manipulation works
4. A list of DSL changes needed to support visual editing (if any)
5. A go/no-go recommendation on whether to proceed to implementation
