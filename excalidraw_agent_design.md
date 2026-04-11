# Excalidraw Agent Redesign — Architecture Design Document

**Author:** Engineering Architect Agent
**Date:** 2026-04-10
**Status:** APPROVED FOR IMPLEMENTATION

---

## 1. Current Architecture Assessment

### 1.1 What Exists Today

The current excalidraw agent (`ts/packages/agents/excalidraw/`) uses a **two-phase, single-shot pipeline**:

```
Phase 1: Source Content → LLM → Mermaid Flowchart
Phase 2: Mermaid Flowchart → LLM (JSON mode) → Excalidraw JSON
Post-processing: repairExcalidrawDiagram() patches broken references
```

**Files:**
- `excalidrawActionHandler.ts` — Single 656-line file containing all logic
- `excalidrawActionSchema.ts` — Action types (CreateDiagram, ExportDiagram)
- `excalidrawManifest.json` — Agent metadata

### 1.2 What's Broken and Why

#### Problem 1: Mermaid as Intermediate Representation is Lossy
Mermaid flowcharts have limited expressiveness for the kind of diagrams users want:
- **No true nesting/containment**: Mermaid `subgraph` is a visual grouping hint, not a spatial containment primitive. When converting to Excalidraw, the LLM has no clear signal for "object B is inside object A."
- **No spatial layout**: Mermaid is a topology description (nodes + edges). All spatial information (positions, sizes, relative placement) must be invented by the LLM in Phase 2, which it does poorly.
- **No style primitives**: Colors, sizes, shapes beyond basic types are lost in the mermaid intermediate.

#### Problem 2: Single-Shot Generation Produces Broken Output
The current approach makes exactly one LLM call per phase with no opportunity to correct mistakes:
- Phase 1 may omit nodes, simplify relationships, or misinterpret the source
- Phase 2 frequently produces:
  - Arrows pointing to non-existent element IDs
  - Overlapping shapes (no spatial awareness)
  - Text that doesn't fit containers
  - Missing elements that were in the mermaid
  - Broken `boundElements` / `containerId` references

#### Problem 3: Repair Function is Superficial
`repairExcalidrawDiagram()` only fixes reference integrity (broken IDs, missing `boundElements` entries). It cannot:
- Add missing nodes that the LLM forgot
- Fix overlapping layouts
- Create proper nesting/containment hierarchies
- Validate completeness against the original input

#### Problem 4: No Feedback Loop
There is no mechanism to:
- Compare the generated diagram against the original input
- Detect structural deficiencies (missing nodes, wrong relationships)
- Ask the LLM to fix specific issues
- Iterate until quality thresholds are met

### 1.3 Root Cause Summary

The fundamental issue is treating diagram generation as a **single-pass translation** when it is inherently an **iterative design problem**. Complex diagrams require:
1. Understanding the semantic structure
2. Planning spatial layout
3. Generating elements
4. Validating against intent
5. Correcting errors
6. Repeating until satisfactory

---

## 2. Proposed Architecture: Iterative Generation with Corrective Loop

### 2.1 High-Level Design

Replace the two-phase pipeline with a **direct generation + iterative correction loop**:

```
┌─────────────────────────────────────────────────────┐
│                  User Request                        │
│  (source content + type + title)                     │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│           Phase 1: Semantic Extraction               │
│  LLM extracts a structured "diagram plan" from the   │
│  source content — nodes, relationships, groups,      │
│  containment hierarchy, and layout hints.            │
│  Output: DiagramPlan (typed JSON)                    │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│        Phase 2: Excalidraw Generation                │
│  LLM converts DiagramPlan → Excalidraw JSON          │
│  with explicit layout instructions and the full       │
│  Excalidraw element spec.                            │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│      Phase 3: Structural Validation                  │
│  Programmatic checks on the generated JSON:          │
│  - All plan nodes present as elements?               │
│  - All plan edges present as arrows?                 │
│  - Containment hierarchy rendered correctly?         │
│  - No overlapping shapes?                            │
│  - All references valid?                             │
│  - Text fits containers?                             │
│  Output: ValidationResult (pass/fail + issues list)  │
└──────────────────────┬──────────────────────────────┘
                       │
                 ┌─────┴─────┐
                 │  Pass?    │
                 └─────┬─────┘
                  yes/ \no
                  /     \
                 ▼       ▼
          ┌──────┐  ┌──────────────────────────────────┐
          │ Done │  │   Phase 4: Corrective Iteration   │
          │ Save │  │  Feed the current JSON + specific  │
          └──────┘  │  error list back to LLM. Ask it   │
                    │  to fix ONLY the listed issues.    │
                    │  Loop back to Phase 3.             │
                    │  Max iterations: 3                 │
                    └──────────────────────────────────┘
```

### 2.2 Key Design Decisions

#### Decision 1: Keep an Intermediate Semantic Representation, but NOT Mermaid
Instead of Mermaid, use a **typed DiagramPlan** — a structured JSON object that explicitly captures:
- Nodes with labels, types (box, diamond, ellipse, group), and optional parent group IDs
- Edges with source/target node IDs and optional labels
- Groups (containers) with explicit child lists — this directly models nesting
- Layout hints (direction: top-down or left-right)

This is strictly more expressive than Mermaid and gives the Excalidraw generation phase precise instructions.

#### Decision 2: Programmatic Validation, Not LLM Validation
The validation phase is **deterministic code**, not another LLM call. This makes it:
- Fast (no API latency)
- Reliable (no hallucinated "looks good" responses)
- Specific (produces exact error descriptions for the correction phase)

#### Decision 3: Bounded Iteration
Maximum 3 correction iterations to prevent infinite loops and runaway API costs. Each iteration should fix a decreasing number of issues. If issues remain after 3 iterations, apply the existing `repairExcalidrawDiagram()` as a final mechanical patch and emit warnings.

#### Decision 4: Direct Excalidraw Generation (No Mermaid)
The generation phase goes directly from DiagramPlan → Excalidraw JSON. This eliminates the lossy Mermaid intermediate and gives the LLM the full context of what it needs to produce.

### 2.3 Handling Nested Objects and Complex Diagrams

The current approach fails at nesting because Mermaid `subgraph` doesn't map cleanly to spatial containment. The new approach handles nesting explicitly:

**In the DiagramPlan:**
```typescript
interface DiagramPlan {
  nodes: PlanNode[];
  edges: PlanEdge[];
  groups: PlanGroup[];
  layoutDirection: "TD" | "LR";
}

interface PlanNode {
  id: string;
  label: string;
  shape: "rectangle" | "diamond" | "ellipse";
  parentGroupId?: string;  // explicit containment
}

interface PlanGroup {
  id: string;
  label: string;
  childNodeIds: string[];   // which nodes are inside
  childGroupIds: string[];  // nested groups
  parentGroupId?: string;   // group nesting
}
```

**In Excalidraw generation**, groups become:
1. A large background rectangle (the container) with a light fill
2. A text label at the top of the container
3. Child elements positioned inside the container bounds
4. The container's dimensions are computed from the bounding box of its children + padding

**In validation**, we check:
- Every node with a `parentGroupId` is spatially inside its parent group's rectangle
- Group rectangles don't overlap with non-member elements
- Nested groups are properly nested spatially

---

## 3. Detailed Component Design

### 3.1 DiagramPlan Types (`diagramPlan.ts` — new file)

```typescript
export interface DiagramPlan {
  title: string;
  layoutDirection: "TD" | "LR";
  nodes: PlanNode[];
  edges: PlanEdge[];
  groups: PlanGroup[];
}

export interface PlanNode {
  id: string;
  label: string;
  shape: "rectangle" | "diamond" | "ellipse";
  parentGroupId?: string;
  color?: string;
}

export interface PlanEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  label?: string;
}

export interface PlanGroup {
  id: string;
  label: string;
  childNodeIds: string[];
  childGroupIds: string[];
  parentGroupId?: string;
  color?: string;
}
```

### 3.2 Validation Types (`diagramValidator.ts` — new file)

```typescript
export interface ValidationIssue {
  severity: "error" | "warning";
  type: "missing_node" | "missing_edge" | "broken_reference" |
        "overlap" | "text_overflow" | "containment_violation" |
        "missing_bound_elements";
  description: string;
  elementId?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  stats: {
    expectedNodes: number;
    foundNodes: number;
    expectedEdges: number;
    foundEdges: number;
    totalElements: number;
  };
}
```

### 3.3 Validation Logic (`diagramValidator.ts`)

The validator performs these checks:

1. **Completeness Check**: Every node in DiagramPlan has a corresponding shape element in the Excalidraw JSON (match by embedded label text)
2. **Edge Check**: Every edge in DiagramPlan has a corresponding arrow element with valid start/end bindings
3. **Reference Integrity**: All `containerId`, `startBinding.elementId`, `endBinding.elementId` reference existing elements
4. **Overlap Detection**: No two non-text shapes at the same level have overlapping bounding boxes (simple AABB intersection)
5. **Containment Check**: Every node with a `parentGroupId` is spatially within its parent group's bounding rectangle
6. **Text Fit Check**: Text element width ≤ container width (using the ~12px/char heuristic)
7. **Bound Elements Consistency**: Shape's `boundElements` array matches actual arrows/text referencing it

### 3.4 Correction Prompt Builder (`correctionPrompt.ts` — new file)

Builds a targeted correction prompt from the validation issues:

```typescript
export function buildCorrectionPrompt(
  currentJson: string,
  issues: ValidationIssue[],
  plan: DiagramPlan
): string {
  // Groups issues by type
  // Provides specific instructions for each issue type
  // Includes the full current JSON and asks for a corrected version
}
```

### 3.5 Refactored Action Handler (`excalidrawActionHandler.ts`)

The handler orchestrates the pipeline:

```typescript
async function handleCreateDiagram(action, context) {
  // 1. Resolve source content (file reading, etc.)
  // 2. Extract DiagramPlan via LLM
  // 3. Generate Excalidraw JSON from DiagramPlan via LLM
  // 4. Validate
  // 5. If issues, iterate (up to 3 times):
  //    a. Build correction prompt
  //    b. LLM corrects
  //    c. Re-validate
  // 6. Final mechanical repair pass
  // 7. Save and return result
}
```

---

## 4. Implementation Plan — File-Level Changes

### 4.1 New Files

| File | Purpose |
|------|---------|
| `src/diagramPlan.ts` | DiagramPlan interface definitions |
| `src/diagramValidator.ts` | Validation logic — checks Excalidraw JSON against DiagramPlan |
| `src/prompts.ts` | All LLM prompt builders (extraction, generation, correction) |

### 4.2 Modified Files

| File | Changes |
|------|---------|
| `src/excalidrawActionHandler.ts` | Rewrite `handleCreateDiagram` to use iterative pipeline. Extract prompts to `prompts.ts`. Keep `repairExcalidrawDiagram()` as final-pass fixup. Keep `handleExportDiagram` and utility functions unchanged. |
| `src/excalidrawActionSchema.ts` | No changes needed — the action types are fine |
| `src/excalidrawManifest.json` | No changes needed |
| `package.json` | No changes needed |

### 4.3 Implementation Order

1. **Create `src/diagramPlan.ts`** — Type definitions only
2. **Create `src/prompts.ts`** — Extract and rewrite all prompt builders:
   - `buildPlanExtractionPrompt(sourceType)` — system prompt for DiagramPlan extraction
   - `buildExcalidrawGenerationPrompt()` — system prompt for Excalidraw JSON generation from plan
   - `buildCorrectionPrompt(currentJson, issues, plan)` — correction prompt
3. **Create `src/diagramValidator.ts`** — Validation logic
4. **Refactor `src/excalidrawActionHandler.ts`** — Wire up the iterative pipeline

### 4.4 Prompt Design

#### Plan Extraction Prompt (Phase 1)
- System role: "You are an expert at analyzing documents and extracting their structure as a diagram plan."
- Output: JSON conforming to DiagramPlan interface
- Key instruction: Capture ALL entities, relationships, AND containment hierarchies. Use groups for any parent-child or container-contained relationships.

#### Excalidraw Generation Prompt (Phase 2)
- System role: Keep the existing detailed Excalidraw format instructions
- Input: The DiagramPlan JSON (not Mermaid)
- Key additions:
  - Explicit instructions for rendering groups as background rectangles
  - Layout algorithm guidance (place children inside parent bounds)
  - Node-to-plan-ID mapping in element metadata (using `customData` field or ID prefixes)

#### Correction Prompt (Phase 4)
- System role: "You are fixing issues in an Excalidraw diagram. Fix ONLY the listed issues."
- Input: Current Excalidraw JSON + specific issue list
- Key instruction: Preserve all correct elements. Only modify elements listed in the issues. Output the complete corrected JSON.

---

## 5. Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| LLM fails to produce valid DiagramPlan JSON | Use JSON mode (`createJsonChatModel`); validate schema programmatically; retry once on parse failure |
| Correction loop doesn't converge | Max 3 iterations; fall back to mechanical repair |
| Increased latency (more LLM calls) | Phase 1 is cheap (small output). Corrections only fire when needed. Typical case: 2-3 calls total vs current 2 |
| API costs increase | Bounded by max iterations; correction prompts include only error-relevant context |
| Regression on simple diagrams | The new pipeline handles simple cases in 2 calls (same as current); validation should pass on first try for simple inputs |

---

## 6. Success Criteria

1. **Nested diagrams render correctly** — child nodes visually inside parent groups
2. **All nodes from source appear in output** — validation confirms 100% node coverage
3. **Arrows connect to valid elements** — zero broken bindings after pipeline
4. **No overlapping shapes** — validation confirms spatial separation
5. **Complex documents (architecture descriptions, multi-level hierarchies) produce usable diagrams** — compared to current baseline

---

## 7. Appendix: Example DiagramPlan

For a "CI/CD Pipeline" with nested stages:

```json
{
  "title": "CI/CD Pipeline",
  "layoutDirection": "LR",
  "nodes": [
    { "id": "n1", "label": "Source Code", "shape": "rectangle" },
    { "id": "n2", "label": "Lint", "shape": "rectangle", "parentGroupId": "g1" },
    { "id": "n3", "label": "Unit Tests", "shape": "rectangle", "parentGroupId": "g1" },
    { "id": "n4", "label": "Build Docker", "shape": "rectangle", "parentGroupId": "g2" },
    { "id": "n5", "label": "Push Registry", "shape": "rectangle", "parentGroupId": "g2" },
    { "id": "n6", "label": "Deploy Staging", "shape": "rectangle", "parentGroupId": "g3" },
    { "id": "n7", "label": "Integration Tests", "shape": "rectangle", "parentGroupId": "g3" },
    { "id": "n8", "label": "Deploy Production", "shape": "rectangle" }
  ],
  "edges": [
    { "id": "e1", "sourceNodeId": "n1", "targetNodeId": "g1", "label": "trigger" },
    { "id": "e2", "sourceNodeId": "n2", "targetNodeId": "n3" },
    { "id": "e3", "sourceNodeId": "g1", "targetNodeId": "g2" },
    { "id": "e4", "sourceNodeId": "n4", "targetNodeId": "n5" },
    { "id": "e5", "sourceNodeId": "g2", "targetNodeId": "g3" },
    { "id": "e6", "sourceNodeId": "n6", "targetNodeId": "n7" },
    { "id": "e7", "sourceNodeId": "g3", "targetNodeId": "n8", "label": "approved" }
  ],
  "groups": [
    { "id": "g1", "label": "Build & Test", "childNodeIds": ["n2", "n3"], "childGroupIds": [], "color": "#a5d8ff" },
    { "id": "g2", "label": "Package", "childNodeIds": ["n4", "n5"], "childGroupIds": [], "color": "#b2f2bb" },
    { "id": "g3", "label": "Deploy", "childNodeIds": ["n6", "n7"], "childGroupIds": [], "color": "#ffd8a8" }
  ]
}
```

This plan unambiguously specifies that "Lint" and "Unit Tests" are **inside** "Build & Test", which the Excalidraw generation phase renders as a background rectangle containing those nodes.
