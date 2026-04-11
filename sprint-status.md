# Excalidraw Agent Redesign — Sprint Status

**Branch:** `dev/georgeng/excalidraw_agent`
**Worktree:** `TypeAgent-excalidraw`
**Started:** 2026-04-10

## Current Phase: COMPLETE
- [x] Worktree created and isolated from main repo
- [x] Deep exploration of current implementation complete
- [x] Architecture design document written (`excalidraw_agent_design.md`)
- [x] Implementation of iterative loop approach
- [x] Testing and validation — 24/24 tests pass

## Milestones

| # | Milestone | Status | Notes |
|---|-----------|--------|-------|
| 1 | Worktree Setup | DONE | `/c/Users/georgeng/repos/TypeAgent-excalidraw` |
| 2 | Code Exploration | DONE | Single handler file, 2-phase mermaid approach identified |
| 3 | Architecture Design | DONE | `excalidraw_agent_design.md` — iterative loop w/ DiagramPlan |
| 4 | Implementation | DONE | 4 files: diagramPlan.ts, prompts.ts, diagramValidator.ts, refactored handler |
| 5 | Testing & Validation | DONE | 24 unit tests covering validator, prompts, plan types |

## What Changed

### Architecture
- **Eliminated Mermaid intermediate representation** — replaced with typed `DiagramPlan` JSON that explicitly captures nodes, edges, groups (containment), and layout direction
- **Added iterative correction loop** — validates generated Excalidraw JSON against the plan, then asks the LLM to fix specific issues (up to 3 iterations)
- **Programmatic validation** — fast, deterministic checks for completeness, reference integrity, spatial containment, overlaps, and text fit

### New Files
| File | Purpose |
|------|---------|
| `src/diagramPlan.ts` | DiagramPlan, PlanNode, PlanEdge, PlanGroup interfaces |
| `src/prompts.ts` | Plan extraction, Excalidraw generation, and correction prompts |
| `src/diagramValidator.ts` | Validates Excalidraw JSON against DiagramPlan (8 check categories) |
| `test/diagramValidator.spec.ts` | 24 unit tests |
| `jest.config.cjs` | Local jest configuration |

### Modified Files
| File | Changes |
|------|---------|
| `src/excalidrawActionHandler.ts` | Rewritten to use DiagramPlan → Excalidraw → Validate → Correct loop |
| `package.json` | Added test scripts and jest dependencies |
| `tsconfig.json` | Added test reference |

### Pipeline Flow (New)
```
Source Content
  → Phase 1: LLM extracts DiagramPlan (structured JSON with groups/containment)
  → Phase 2: LLM generates Excalidraw JSON from DiagramPlan (with ID conventions)
  → Phase 3: Programmatic validation (8 check categories)
  → Phase 4: If errors, LLM fixes specific issues (max 3 iterations)
  → Final: Mechanical repair pass (arrow geometry, reference patching)
  → Save .excalidraw file
```

### Why This Is Better
1. **Nested objects**: DiagramPlan has explicit `parentGroupId` and `childNodeIds` — groups become background rectangles with children positioned inside
2. **No mermaid losiness**: DiagramPlan preserves containment, colors, shapes, layout hints
3. **Iterative correction**: LLM gets specific error feedback ("node n2 missing", "node n3 outside group g1") and fixes only those issues
4. **Deterministic validation**: No relying on LLM to judge its own output — programmatic checks are fast and reliable
5. **ID conventions**: `shape-n1`, `text-n1`, `arrow-e1`, `group-g1` enable precise traceability from plan to output

## Key Findings (Exploration Phase)
- Current approach: 2-phase (source -> mermaid -> excalidraw JSON) via two LLM calls
- No iterative correction loop — single-shot generation
- Repair function exists but only patches broken references, doesn't fix layout or missing elements
- Mermaid intermediate format loses nested/containment semantics
- No validation against the original intent
- No support for iterative refinement based on structural errors

## Test Results
```
PASS dist/test/diagramValidator.spec.js
  DiagramValidator
    valid diagrams .......................... 2 passed
    missing elements ....................... 4 passed
    broken references ...................... 2 passed
    containment violations ................. 1 passed
    bound elements consistency ............. 1 passed
    empty and edge cases ................... 2 passed
    statistics tracking .................... 1 passed
  Prompt Builders .......................... 6 passed
  DiagramPlan structure .................... 3 passed

Test Suites: 1 passed, 1 total
Tests:       24 passed, 24 total
```
