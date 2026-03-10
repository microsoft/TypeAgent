# TaskFlow Suggestion File Format

Suggestion files are created during recipe recording or compilation when Claude notices that
existing actions or missing actions are limiting what the compiled flow can do well.

Filename: `ACTION_NAME.suggestions.md` (where ACTION_NAME is the recipe's actionName)

Suggestions are NOT blocking — the recipe is compiled with what's available today. The
developer reviews these and works with Claude to implement improvements.

---

## Format

```markdown
# Suggestions for: ACTION_NAME

Recorded during: YYYY-MM-DD
Recipe: pending/ACTION_NAME.recipe.json

## Summary

Brief description of the main gaps noticed during recording/compilation.

## Suggested Changes

### 1. Add JSON output to player.searchTopStreaming

**Type**: Modify existing action
**File**: packages/agents/player/src/...
**Rationale**: Action currently returns a plain text list. The compiled flow has to parse
"1. Song Title by Artist" format which is fragile. A `{ outputFormat: "json" }` parameter
returning `[{ title, artist, streams }]` would let the handler use typed data directly.
**Impact**: High — simplifies parsing, avoids regex fragility, enables type safety
**Effort**: Low — add parameter + conditional return format in handler

### 2. New action: player.addTracksToPlaylist

**Type**: New action
**Rationale**: Currently requires a separate callAction for each track. A batch add action
would reduce the number of calls from O(n) to O(1) for playlist creation flows.
**Proposed schema**:

- `playlistId: string` — ID of the existing playlist
- `tracks: Array<{ title: string, artist: string }>` — tracks to add
  **Effort**: Medium

### 3. New utility agent: utility.webSearch

**Type**: New agent action (utility agent does not exist yet)
**Rationale**: Recording flows that include web research steps need a utility.webSearch action.
The utility agent should be created at packages/agents/utility/ with webSearch, webFetch,
readFile, writeFile actions.
**Effort**: Medium (new agent package)

## Notes

Any other observations about the recording session, edge cases noticed, etc.
```

---

## When to Create a Suggestion File

Create a suggestion file when you notice:

- An action returns text that would be much cleaner as JSON
- An action is missing a parameter that would be useful for compiled flows
- A multi-step sequence that could be a single higher-level action
- A missing action that the recipe needs (e.g., utility.webSearch)
- Output format inconsistencies that complicate parsing

## When NOT to Create a Suggestion File

- Minor style issues
- Things that are already on the project roadmap
- Suggestions that only affect dev ergonomics, not correctness
