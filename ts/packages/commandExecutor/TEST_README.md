<!--
Copyright (c) Microsoft Corporation.
Licensed under the MIT License.
-->

# Command Executor MCP Server Tests

## NFA Cache Integration Test

This directory contains integration tests for the NFA grammar cache system.

### Test Overview

The **NFA Cache Integration Test** (`nfaCacheIntegration.spec.ts`) verifies the complete cache flow:

1. **Initial Execution** - Requests are processed and cache is populated with grammar rules
2. **Cache Hit Verification** - Same requests are re-executed after 120s to verify cache hits
3. **Grammar Generalization** - Similar requests with same structure are tested to verify grammar patterns work

### Prerequisites

**IMPORTANT**: This test requires a running TypeAgent dispatcher server.

#### Step 1: Start the Dispatcher Server

```bash
# From the root of the TypeAgent repository
cd ts
pnpm run start:agent-server
```

The dispatcher should be running at `ws://localhost:8999`.

#### Step 2: Configure the Dispatcher for NFA Cache

The test will automatically configure the MCP server for NFA mode, but you can also manually configure the dispatcher by running:

```bash
# In the dispatcher CLI
@config cache.grammarSystem nfa
```

### Running the Tests

```bash
# Build the package first
cd packages/commandExecutor
npm run build

# Install dependencies (if not already installed)
npm install

# Run all tests
npm test

# Run only the integration test
npm run test:integration
```

### Test Structure

```
Phase 1: Initial Requests (Cache Population)
  - Execute: "play Bohemian Rhapsody by Queen"
  - Execute: "add milk to my shopping list"
  - Execute: "schedule dentist appointment tomorrow at 3pm"
  - Expected: CACHE_MISS (first time seeing these patterns)

Phase 2: Waiting for Cache Persistence
  - Wait 120 seconds for:
    - Grammar rules to be generated
    - Rules to be persisted to disk
    - Cache to be fully populated

Phase 3: Repeated Requests (Cache Hit Verification)
  - Re-execute same requests from Phase 1
  - Expected: CACHE_HIT (rules now in cache)

Phase 4: Similar Requests (Grammar Generalization)
  - Execute: "play Stairway to Heaven by Led Zeppelin"
  - Execute: "add eggs to my shopping list"
  - Execute: "schedule team meeting next Monday at 2pm"
  - Expected: CACHE_HIT (matches grammar patterns from Phase 1)
```

### What the Test Verifies

- ✅ MCP server loads NFA configuration correctly
- ✅ MCP server applies configuration to dispatcher via `@config` commands
- ✅ Initial requests populate the grammar cache
- ✅ Repeated requests hit the cache
- ✅ Similar requests match via grammar generalization
- ✅ Cache hit/miss detection works correctly

### Test Output

The test provides detailed console output showing:

- Each request being executed
- Cache hit/miss status
- Cache hit rates for each phase
- Grammar generalization success rate

Example output:

```
=== Phase 1: Initial Requests (Cache Population) ===

Executing: "play Bohemian Rhapsody by Queen"
  Cache status: MISS
  Result: Successfully executed: play Bohemian Rhapsody by Queen...

=== Phase 3: Repeated Requests (Cache Hit Verification) ===

Re-executing: "play Bohemian Rhapsody by Queen"
  Cache status: HIT
  Result: CACHE_HIT: Successfully executed from cache...

📊 Cache Hit Rate: 100.0%

=== Phase 4: Similar Requests (Grammar Generalization Test) ===

Original: "play Bohemian Rhapsody by Queen"
Similar:  "play Stairway to Heaven by Led Zeppelin"
  Cache status: HIT ✓
  ✓ Grammar generalization successful!

📊 Generalization Rate: 100.0%
```

### Timeout Configuration

The test has a 4-minute timeout (240 seconds) to accommodate:

- Server startup and connection
- Initial request processing (with potential explainer invocations)
- 120-second wait for cache persistence
- Repeated request execution
- Similar request execution

### Troubleshooting

**Test times out connecting to dispatcher**:

- Ensure `pnpm run start:agent-server` is running
- Verify dispatcher is accessible at `ws://localhost:8999`
- Check firewall settings

**Low cache hit rates**:

- Verify `@config cache.grammarSystem nfa` is set in dispatcher
- Check that grammar generation is enabled: `@config cache.grammar on`
- Verify persisted grammar store is being saved: check `~/.typeagent/sessions/<session>/grammars/dynamic.json`
- Check dispatcher logs for grammar generation errors

**Test fails to build**:

```bash
# Ensure dependencies are installed
npm install

# Build dependencies first
cd ../cache && npm run build
cd ../actionGrammar && npm run build
cd ../dispatcher/dispatcher && npm run build
cd ../../commandExecutor && npm run build
```

### Manual Testing

You can also manually test the MCP server using the test client:

```bash
# Start the dispatcher first
pnpm run start:agent-server

# In another terminal, run the test client
cd packages/commandExecutor
npm run build
node test/testClient.js
```

### Test Duration

- **Quick test** (skip wait): ~10 seconds (modify test to remove 120s wait)
- **Full integration test**: ~3-4 minutes (includes 120s wait for persistence)

### Notes

- This test modifies the dispatcher configuration during execution
- Test uses temporary configuration files in `/tmp/typeagent-test-config`
- Configuration is cleaned up after test completion
- The test focuses on cache behavior, not actual action execution
- Grammar rules persist across test runs in the dispatcher session

---

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to and must follow [Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks). Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship. Any use of third-party trademarks or logos are subject to those third-party's policies.
