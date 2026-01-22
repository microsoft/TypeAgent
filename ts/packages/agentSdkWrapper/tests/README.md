# Grammar Generation Test Cases

This directory contains test cases for the Claude-based grammar generator.

## Test Files

### Good Cases (Should Generate Grammar)

**simpleTest.jsonl** - Single weather example for quick testing

**weatherTests.jsonl** - 5 weather test cases with interrogatives and locations

**playerTests.jsonl** - 7 music player test cases covering:

- Track playback with artists
- Device selection (entity types)
- Volume control (numbers)
- Track selection (ordinals)
- Pause/resume (no parameters)

**optionalPhrases.jsonl** - 4 tests with politeness markers:

- "would you please play..."
- "could you tell me..."
- "please show me..."

**playerDiverseTests.jsonl** - 30 diverse player tests covering:

- Number transformations (quantity)
- Boolean transformations (shuffle on/off)
- Ordinal parsing (third, tenth)
- Entity types (MusicDevice)
- Optional politeness
- Minimal vs verbose forms
- Various sentence structures

### Rejection Cases

**badCases.jsonl** - Cases that should NOT generate grammar:

1. Referential phrases ("it", "that") requiring context
2. Open-ended query parameters
3. Good case included for comparison (qualified wildcards)

**calendarTests.jsonl** - Calendar examples (EXPECTED TO FAIL):

- Complex object parameters (Event, EventReference with nested fields)
- Contextual references ("the meeting", "it")
- Temporal expressions too complex for grammar patterns
- These are examples of when grammar generation is not appropriate

## Expected Rejections

Grammar generation should reject when:

1. **Adjacent unqualified wildcards** - Two plain string wildcards without separator or validation
2. **Referential phrases** - "it", "that", "this", "them" requiring conversation history
3. **Query/search parameters** - Open-ended text capture without validation
4. **Complex object parameters** - Nested objects like Event, EventReference (calendar)
5. **Missing critical context** - Requests depending on prior conversation

## Qualified vs Unqualified Wildcards

**Qualified wildcards** (OK to be adjacent):

- Entity types: `$(deviceName:MusicDevice)`
- Validation specs: `checked_wildcard`, `ordinal`, `number`, `percentage`

**Unqualified wildcards** (NOT OK adjacent):

- Plain strings without validation: `$(firstName:string) $(lastName:string)`
