# Base Grammar Pattern Tests - Status

## Summary

Comprehensive unit tests have been added in `baseGrammarPatterns.spec.ts` to verify that base grammar patterns match correctly.

## Current Status

### Working in Runtime ✅

The base grammar patterns are working correctly in the actual runtime system:

- "play big red sun by lucinda williams" → MATCHED
- Captures: `trackName="big red sun"`, `artist="lucinda williams"`
- Action executed successfully

### Test Harness Issue ⚠️

The unit tests are currently failing due to a variable capture issue in how nested rules work:

- NFA matching succeeds ✅
- Variable captures are incorrect (capturing to `x` instead of `trackName`, `artist`) ❌
- This appears to be a difference between how the test harness calls the matching functions vs how the runtime grammarStore uses them

## Root Cause

The player grammar defines nested rules:

```
@ <TrackName> = $(x:string)
@ <ArtistName> = $(x:string)
```

When referenced as `$(trackName:<TrackName>)`, the inner `$(x:string)` captures override the outer variable name `trackName`.

In the runtime system (grammarStore), this works correctly. In the test harness, it doesn't.

## Next Steps

1. Investigate how grammarStore.match() processes NFA results vs how the test calls matchGrammarWithNFA()
2. Determine if the issue is in:
   - NFA compilation (preserving outer variable names)
   - NFA matching (capture propagation)
   - Test setup (missing configuration)
3. Fix the variable capture mechanism to preserve outer variable names when using nested rules

## Test Coverage

The test file covers:

- ✅ Player: pause/resume commands
- ✅ Player: "play X by Y" patterns
- ✅ Player: "play X from album Y" patterns
- ✅ Player: "play X by Y from album Z" patterns
- ✅ Calendar: find today's events
- ✅ Calendar: find this week's events
- ✅ Calendar: schedule events

All patterns are structurally correct and match successfully in the NFA, but parameter extraction needs investigation.
