# Excalidraw Agent Redesign — Sprint Status

**Branch:** `dev/georgeng/excalidraw_agent`
**Worktree:** `TypeAgent-excalidraw`
**Started:** 2026-04-10

## Current Phase: BUG FIX & HARDENING COMPLETE
- [x] Worktree created and isolated from main repo
- [x] Deep exploration of current implementation complete
- [x] Architecture design document written (`excalidraw_agent_design.md`)
- [x] Implementation of iterative loop approach
- [x] Testing and validation — 24/24 tests pass
- [x] Fix max_tokens bug (8000/16000 exceeded model's 4096 limit)
- [x] Add stripMarkdownFences for JSON parse robustness
- [x] Improve error messages for parse failures
- [x] Full end-to-end pipeline review — no further bugs found
- [x] TypeScript compilation clean — 0 errors
- [x] All 24 tests passing

## Milestones

| # | Milestone | Status | Notes |
|---|-----------|--------|-------|
| 1 | Worktree Setup | DONE | `/c/Users/georgeng/repos/TypeAgent-excalidraw` |
| 2 | Code Exploration | DONE | Single handler file, 2-phase mermaid approach identified |
| 3 | Architecture Design | DONE | `excalidraw_agent_design.md` — iterative loop w/ DiagramPlan |
| 4 | Implementation | DONE | 4 files: diagramPlan.ts, prompts.ts, diagramValidator.ts, refactored handler |
| 5 | Testing & Validation | DONE | 24 unit tests covering validator, prompts, plan types |
| 6 | Bug Fix: max_tokens | DONE | Removed hardcoded max_tokens (8000/16000) that exceeded model's 4096 limit |
| 7 | Robustness Improvements | DONE | stripMarkdownFences, better error messages, full pipeline review |

## What Changed

### Bug Fixes (2026-04-10)

#### Fix 1: max_tokens exceeds model limit (CRITICAL)
**Error:** `fetch error: 400: Bad Request: max_tokens is too large: 8000. This model supports at most 4096 completion tokens`

**Root cause:** All three LLM calls in the pipeline had hardcoded `max_tokens` overrides:
- Phase 1 (plan extraction): `{ max_tokens: 8000 }` — exceeds 4096 limit
- Phase 2 (excalidraw generation): `{ max_tokens: 16000 }` — exceeds 4096 limit
- Phase 3 (correction): `{ max_tokens: 16000 }` — exceeds 4096 limit

**Fix:** Removed all `max_tokens` overrides. `openai.createJsonChatModel()` is now called with no arguments, which lets the API use the model's default maximum token limit. This is model-agnostic and respects whatever model is configured.

#### Fix 2: JSON parse robustness
**Issue:** Some models emit markdown code fences (` ```json ... ``` `) even in `json_object` mode, causing `JSON.parse` to fail.

**Fix:** Added `stripMarkdownFences()` utility that strips markdown fencing before parsing. Applied to all three JSON parse sites (plan extraction, excalidraw generation, correction).

#### Fix 3: Better error diagnostics
**Issue:** Parse failures returned generic "please try again" messages with no context.

**Fix:** Error messages now include the specific parse error and the last 200 characters of the LLM response, making debugging much easier.

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
