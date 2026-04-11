# Excalidraw Agent Redesign — Sprint Status

**Branch:** `dev/georgeng/excalidraw_agent`
**Worktree:** `TypeAgent-excalidraw`
**Started:** 2026-04-10

## Current Phase: MINIMAL SCHEMA MIGRATION COMPLETE
- [x] Worktree created and isolated from main repo
- [x] Deep exploration of current implementation complete
- [x] Architecture design document written (`excalidraw_agent_design.md`)
- [x] Implementation of iterative loop approach
- [x] Testing and validation — 24/24 tests pass
- [x] Fix max_tokens bug (8000/16000 exceeded model's 4096 limit)
- [x] Add stripMarkdownFences for JSON parse robustness
- [x] Improve error messages for parse failures
- [x] Full end-to-end pipeline review — no further bugs found
- [x] Fix JSON truncation for large diagrams (Option B: compact output + Option A: chunked generation)
- [x] Add truncation recovery as last-ditch safety net
- [x] **Switch to MinimalDiagram schema — LLM generates ~5x smaller output, TypeScript expands deterministically**
- [x] New `expandToExcalidraw()` function handles all Excalidraw field population
- [x] Correction loop updated to work in minimal format
- [x] TypeScript compilation clean — 0 errors
- [x] All 81 tests passing (54 previous + 27 new for minimal schema + expandToExcalidraw)

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
| 8 | Fix: JSON Truncation | DONE | Compact output (Option B) + Chunked generation (Option A) + Truncation recovery |
| 9 | MinimalDiagram Schema | DONE | LLM generates ~5x smaller MinimalDiagram; `expandToExcalidraw()` expands deterministically to full Excalidraw JSON |

## What Changed

### Bug Fixes (2026-04-10)

#### Fix 5: Switch to MinimalDiagram schema to eliminate truncation (CRITICAL)
**Error:** Despite compact output instructions and chunked generation, LLM still emits verbose Excalidraw fields (`seed`, `version`, `opacity`, `roughness`, `fillStyle`, `strokeWidth`, etc.) causing truncation at ~12,761 chars for large diagrams (18 nodes, 13 edges = 31 items).

**Root cause:** Asking the LLM to produce Excalidraw JSON (even "compact") relies on the LLM to actually omit ~20 default fields per element. LLMs frequently ignore this instruction, producing verbose output that exceeds token limits.

**Fix — MinimalDiagram schema + deterministic expansion:**
1. **New MinimalDiagram format:** LLM now generates a compact intermediate format with only ~7 fields per element (`id`, `type`, `x`, `y`, `w`, `h`, `label`/`from`/`to`) — ~5x smaller than full Excalidraw JSON.
2. **New `expandToExcalidraw()` function:** ~200 lines of TypeScript that deterministically converts MinimalDiagram → full Excalidraw document with all required fields (strokeColor, backgroundColor, fillStyle, seed, version, etc.), arrow edge-point geometry, text label binding, and boundElements wiring.
3. **Correction loop updated:** Phase 4 now uses `buildMinimalCorrectionPrompt()` to correct in minimal format, then re-expands — keeping correction prompts small.
4. **Result:** A 31-element diagram produces well under 4000 chars of LLM output (verified by test), eliminating truncation entirely.

**New test coverage:** 27 new tests covering `expandToExcalidraw` (basic expansion, field completeness, group/frame expansion, arrow labels, boundElements wiring, default dimensions, plan validation, output size comparison, empty diagram, ellipse/diamond types), `buildMinimalDiagramPrompt`, and `buildMinimalCorrectionPrompt`.

#### Fix 4: JSON truncation for large diagrams (CRITICAL)
**Error:** `Unterminated string in JSON at position 12564` — LLM output truncated mid-response for diagrams with 16+ nodes, 7+ edges, 2+ groups.

**Root cause:** Large diagrams produce Excalidraw JSON that exceeds the model's output token limit (~4096 tokens), causing the response to be truncated mid-JSON.

**Fix (3-layer defense):**
1. **Option B — Compact output:** Updated prompts to instruct LLM to omit default fields (angle, strokeColor, fillStyle, etc.). Added `injectDefaults()` to programmatically fill in missing defaults post-parse. Reduces output size by ~40%.
2. **Option A — Chunked generation:** For large diagrams (>12 plan items), Phase 2 splits into 3 sequential LLM calls: groups -> nodes -> edges. Each chunk stays well within token limits. Added `shouldUseChunkedGeneration()`, `buildChunkedGroupsPrompt()`, `buildChunkedNodesPrompt()`, `buildChunkedEdgesPrompt()`.
3. **Truncation recovery:** Added `recoverTruncatedJson()` as a last-ditch salvage mechanism — finds the last complete JSON object and closes unmatched brackets. Used by `parseJsonWithRecovery()` which wraps all JSON parsing.

**New test coverage:** 30 new tests covering `injectDefaults`, `recoverTruncatedJson`, `shouldUseChunkedGeneration`, and all chunked prompt builders.

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
  → Phase 2: LLM generates MinimalDiagram JSON (~5x smaller than Excalidraw)
  → Phase 2b: TypeScript expandToExcalidraw() deterministically expands to full Excalidraw JSON
  → Phase 3: Programmatic validation (8 check categories)
  → Phase 4: If errors, LLM fixes specific issues in MinimalDiagram format (max 3 iterations)
  → Phase 4b: Re-expand corrected MinimalDiagram to Excalidraw JSON
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
  Prompt Builders
    buildPlanExtractionPrompt .............. 3 passed
    buildExcalidrawGenerationPrompt ........ 3 passed
    buildMinimalDiagramPrompt .............. 6 passed
    buildMinimalCorrectionPrompt ........... 2 passed
    buildCorrectionPrompt .................. 2 passed
  DiagramPlan structure .................... 3 passed
  injectDefaults ........................... 8 passed
  recoverTruncatedJson ..................... 6 passed
  shouldUseChunkedGeneration ............... 5 passed
  Chunked prompt builders .................. 11 passed
  expandToExcalidraw
    basic expansion ........................ 4 passed
    field completeness ..................... 3 passed
    group/frame expansion .................. 2 passed
    arrow label expansion .................. 2 passed
    boundElements wiring ................... 1 passed
    default dimensions ..................... 1 passed
    validates against plan ................. 2 passed
    output size comparison ................. 1 passed
    empty diagram .......................... 1 passed
    ellipse and diamond types .............. 2 passed

Test Suites: 1 passed, 1 total
Tests:       81 passed, 81 total
```
