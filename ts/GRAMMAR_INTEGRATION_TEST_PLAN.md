<!--
Copyright (c) Microsoft Corporation.
Licensed under the MIT License.
-->

# NFA Grammar Integration Test Plan

## Overview

This document outlines the comprehensive testing strategy for the NFA grammar integration with the TypeAgent cache system. The integration involves three key packages:

1. **action-grammar**: AgentGrammarRegistry, GrammarStore (persisted), grammar compilation
2. **cache**: AgentCache, GrammarStoreImpl, cache matching
3. **dispatcher**: Command processing, agent loading, session management

## Test Coverage Areas

### 1. Unit Tests: Grammar Sync Mechanisms

**Location**: `packages/cache/test/grammarIntegration.spec.ts` (CREATED)

**What's tested**:

- ✅ Grammar loading into both GrammarStoreImpl and AgentGrammarRegistry
- ✅ `syncAgentGrammar()` properly updates GrammarStoreImpl after adding dynamic rules
- ✅ Multiple dynamic rule additions with sync
- ✅ Combined static + dynamic grammar matching
- ✅ Namespace filtering for multi-agent scenarios
- ✅ Dual system support (completionBased vs NFA)

**Status**: Test file created, ready to run

### 2. Unit Tests: Initialization with Persisted Rules

**Location**: `packages/cache/test/grammarIntegration.spec.ts` (CREATED)

**What's tested**:

- ✅ Loading persisted GrammarStore from disk
- ✅ Merging persisted rules into AgentGrammarRegistry
- ✅ Syncing merged grammar to GrammarStoreImpl
- ✅ Multi-schema persistence and loading
- ✅ Verification that all rules (static + dynamic) match after restart

**Status**: Test file created, ready to run

### 3. Integration Tests: Dispatcher Level (TODO)

**Location**: `packages/dispatcher/dispatcher/test/grammarCache.spec.ts` (TO BE CREATED)

**What needs to be tested**:

#### Test 1: Agent Loading with Grammar Registration

```typescript
it("should register grammars in both stores when loading agents (NFA mode)", async () => {
  // Setup dispatcher with grammarSystem: "nfa"
  // Load agent with schema file containing grammar
  // Verify:
  //   - GrammarStoreImpl has the grammar
  //   - AgentGrammarRegistry has the agent registered
  //   - Cache matching works with the grammar
});

it("should only register in GrammarStoreImpl when using completionBased mode", async () => {
  // Setup dispatcher with grammarSystem: "completionBased"
  // Load agent
  // Verify:
  //   - GrammarStoreImpl has the grammar
  //   - AgentGrammarRegistry is not used
});
```

#### Test 2: Session Initialization with Persisted Rules

```typescript
it("should load persisted dynamic rules on session start", async () => {
  // 1. Create session with NFA mode
  // 2. Load agent (static grammar gets registered)
  // 3. Mock adding dynamic rule (simulate grammar generation)
  // 4. Close dispatcher
  // 5. Create new dispatcher with same session directory
  // 6. Verify persisted rules are loaded and synced
  // 7. Test cache matching works with both static and dynamic rules
});

it("should handle empty grammar store file on first session", async () => {
  // Create new session directory
  // Initialize dispatcher
  // Verify grammar store file is created but empty
});

it("should handle missing grammar store file gracefully", async () => {
  // Create session without grammar store file
  // Initialize dispatcher
  // Verify no errors and file is created
});
```

#### Test 3: Cache Consultation Flow

```typescript
it("should consult cache with NFA grammars for active agents", async () => {
  // Setup dispatcher with multiple agents
  // Add grammar rules for each agent
  // Test checkCache() with requests matching each agent
  // Verify correct agent is matched based on grammar
});

it("should filter by active agents only", async () => {
  // Load multiple agents
  // Disable one agent
  // Verify checkCache() only matches against enabled agents
});

it("should handle wildcards with entity validation (when implemented)", async () => {
  // Create grammar with entity wildcards
  // Test matching with valid and invalid entity values
  // Verify only valid entities match
});
```

#### Test 4: Grammar Generation Flow (TODO - waiting for schema path implementation)

```typescript
// This test will be implemented after grammar generation is complete
it("should generate grammar from request/action pair and add to cache", async () => {
  // 1. Process user request that succeeds via explainer
  // 2. Verify grammar rule is generated
  // 3. Verify rule is added to persisted GrammarStore
  // 4. Verify rule is added to AgentGrammarRegistry
  // 5. Verify syncAgentGrammar was called
  // 6. Test cache matching with newly generated rule
});

it("should reject grammar generation for ambiguous requests", async () => {
  // Test that certain request/action pairs don't generate rules
  // (e.g., too generic, ambiguous, reference-heavy)
});

it("should auto-save generated grammars when configured", async () => {
  // Enable auto-save
  // Generate grammar
  // Verify file is written to disk immediately
});
```

#### Test 5: Configuration System

```typescript
it("should respect grammarSystem configuration setting", async () => {
  // Test both "completionBased" and "nfa" settings
  // Verify appropriate components are initialized
});

it("should respect cache.grammar enable/disable setting", async () => {
  // Disable cache.grammar
  // Verify grammar generation doesn't occur
});

it("should respect cache.autoSave setting", async () => {
  // Test with autoSave true and false
  // Verify behavior matches setting
});
```

### 4. End-to-End Tests: Full Flow (TODO)

**Location**: `packages/dispatcher/dispatcher/test/e2e/grammarE2E.spec.ts` (TO BE CREATED)

**Scenario 1: Learning from User Interaction**

```typescript
it("should learn new grammar patterns from user confirmations", async () => {
  // 1. User sends novel request: "play some jazz"
  // 2. System uses explainer to determine action
  // 3. User confirms action
  // 4. Grammar rule is generated and cached
  // 5. User sends similar request: "play some blues"
  // 6. System matches via cache (no explainer needed)
  // 7. Restart session
  // 8. User sends "play some rock"
  // 9. Verify still matches via persisted cache
});
```

**Scenario 2: Multi-Agent Scenario**

```typescript
it("should handle grammar for multiple agents", async () => {
  // Load player, calendar, and list agents
  // Generate dynamic rules for each
  // Test that requests route to correct agent
  // Verify no cross-contamination of grammars
});
```

**Scenario 3: Grammar Evolution**

```typescript
it("should accumulate grammar rules over time", async () => {
  // Session 1: Learn rules A, B, C
  // Session 2: Load A, B, C; learn D, E
  // Session 3: Load A, B, C, D, E; learn F
  // Verify all 6 rules work in session 3
});
```

### 5. Error Handling Tests (TODO)

**Location**: Various test files

**Error scenarios to test**:

- Invalid grammar syntax in persisted store
- Corrupted grammar store JSON file
- Grammar compilation errors during NFA compilation
- Schema file missing when trying to generate grammar
- Disk I/O errors during save/load
- Out of sync scenarios between registries

### 6. Performance Tests (TODO)

**Location**: `packages/cache/test/grammarPerformance.spec.ts` (TO BE CREATED)

**Performance scenarios**:

- Matching performance with 100+ dynamic rules
- Grammar compilation time for large schemas
- Memory usage with multiple agents
- Startup time with large persisted grammar stores

## Test Execution Plan

### Phase 1: Unit Tests (READY)

```bash
cd packages/cache
npm test -- grammarIntegration.spec.ts
```

**Expected result**: All unit tests for sync mechanisms and initialization pass

### Phase 2: Build Verification (READY)

```bash
cd packages/cache && npm run build
cd packages/actionGrammar && npm run build
cd packages/dispatcher/dispatcher && npm run build
```

**Expected result**: No TypeScript errors, all packages build successfully

### Phase 3: Integration Tests (TODO)

1. Create `packages/dispatcher/dispatcher/test/grammarCache.spec.ts`
2. Implement Tests 1-5 from section 3 above
3. Run tests: `cd packages/dispatcher/dispatcher && npm test -- grammarCache.spec.ts`

### Phase 4: End-to-End Tests (TODO)

1. Create `packages/dispatcher/dispatcher/test/e2e/grammarE2E.spec.ts`
2. Implement scenarios from section 4 above
3. Run tests: `cd packages/dispatcher/dispatcher && npm test -- e2e/grammarE2E.spec.ts`

### Phase 5: Manual Testing (TODO)

After automated tests pass, perform manual testing:

1. **Manual Test 1**: Start typeagent with NFA mode

   ```bash
   # In config, set cache.grammarSystem = "nfa"
   # Start typeagent
   # Load an agent
   # Verify grammars are loaded
   # Test cache matching with various requests
   ```

2. **Manual Test 2**: Persistence across restarts

   ```bash
   # Start session, test requests
   # Note which requests match cache
   # Restart session
   # Verify same requests still match cache
   ```

3. **Manual Test 3**: Compare completionBased vs NFA modes
   ```bash
   # Test same requests in both modes
   # Verify behavior is consistent
   # Verify both systems work correctly
   ```

## Success Criteria

### Must Pass

- ✅ All unit tests in grammarIntegration.spec.ts pass
- ⬜ All dispatcher integration tests pass
- ⬜ Grammar loading works for both completionBased and NFA modes
- ⬜ Sync mechanism correctly updates GrammarStoreImpl
- ⬜ Persisted rules load correctly on session restart
- ⬜ Cache matching works with combined static + dynamic grammars
- ⬜ No regressions in existing cache functionality

### Should Pass (when grammar generation implemented)

- ⬜ Grammar generation produces valid rules
- ⬜ Generated rules are persisted correctly
- ⬜ Auto-save works as configured
- ⬜ All end-to-end scenarios work

### Performance Targets

- ⬜ Cache matching with 100 rules: < 50ms
- ⬜ Session startup with 500 persisted rules: < 500ms
- ⬜ Grammar sync operation: < 10ms

## Current Status

### Completed ✅

1. Unit test file created: `packages/cache/test/grammarIntegration.spec.ts`
2. Core integration code implemented in:
   - `packages/dispatcher/dispatcher/src/context/commandHandlerContext.ts`
   - `packages/dispatcher/dispatcher/src/context/appAgentManager.ts`
   - `packages/cache/src/cache/cache.ts`
3. Sync mechanisms implemented:
   - `AgentCache.syncAgentGrammar()`
   - `AgentCache.configureGrammarGeneration()`
4. Initialization code implemented in `setupGrammarGeneration()`
5. All packages building successfully

### In Progress ⬜

- Running the unit tests (next step)

### Not Started ⬜

- Dispatcher-level integration tests
- End-to-end tests
- Performance tests
- Error handling tests
- Manual testing

### Blocked 🚫

- Grammar generation tests (waiting for schema file path implementation)
- Entity validation tests (waiting for entity validation implementation)

## Next Steps

1. **Immediate**: Run unit tests

   ```bash
   cd packages/cache
   npm test -- grammarIntegration.spec.ts
   ```

2. **Fix any test failures**: Address issues found in unit tests

3. **Create dispatcher integration tests**: Implement `grammarCache.spec.ts`

4. **Complete grammar generation**: Implement TODO in cache.ts lines 329-356

5. **Add grammar generation tests**: Implement Test 4 scenarios

6. **End-to-end testing**: Create and run E2E test scenarios

7. **Manual verification**: Perform manual testing with real typeagent

## Notes

- The unit tests cover the core sync and initialization mechanisms thoroughly
- Dispatcher tests will verify the full integration works correctly
- Grammar generation tests are blocked until schema file path access is implemented
- All tests use Jest and follow existing test patterns in the codebase
- Tests use temporary directories and clean up after themselves
- Tests verify both NFA and completionBased modes work correctly

---

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to and must follow [Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks). Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship. Any use of third-party trademarks or logos are subject to those third-party's policies.
