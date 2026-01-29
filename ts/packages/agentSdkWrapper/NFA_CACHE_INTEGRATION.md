# NFA Cache Integration with agentSdkWrapper

## Overview

This document describes the NFA (Non-deterministic Finite Automaton) grammar cache integration with the agentSdkWrapper CLI tool. The integration allows you to test NFA cache behavior directly from the agent SDK wrapper with automatic logging when new grammar rules are added.

## Changes Made

### 1. Grammar Rule Logging ([agentGrammarRegistry.ts:94-108](../../actionGrammar/src/agentGrammarRegistry.ts#L94-L108))

Added console logging in `AgentGrammar.addGeneratedRules()` to print new grammar rules when they are added to the cache:

```typescript
// Log the newly added grammar rules for debugging/testing
const newRulesCount = this.ruleCount - previousRuleCount;
if (newRulesCount > 0) {
    console.log(
        `\n[Grammar Cache] Added ${newRulesCount} new rule(s) to agent '${this.agentId}':`,
    );
    console.log(`--- New Grammar Rules ---`);
    console.log(agrText);
    console.log(`--- Total rules: ${this.ruleCount} ---\n`);
}
```

This logging appears in the **agent server console output** (not the SDK wrapper console) whenever new dynamic grammar rules are generated and added to an agent's grammar.

### 2. NFA Cache CLI Flag ([cli.ts](./src/cli.ts))

Added `--nfa-cache` flag to enable NFA grammar cache mode:

```bash
agent-sdk-wrapper --nfa-cache
```

When enabled, this flag:
- Creates a temporary configuration file with NFA cache settings
- Passes the config file path to the MCP server via `AGENT_SERVER_CONFIG` environment variable
- Enables grammar rule generation and caching in the agent server

### 3. Configuration File Generation ([cli.ts:271-309](./src/cli.ts#L271-L309))

When `--nfa-cache` is specified, the wrapper automatically creates a configuration file:

**IMPORTANT**: The configuration is passed to the MCP server subprocess via the `AGENT_SERVER_CONFIG` environment variable. The subprocess environment is created by merging with `process.env` to ensure all necessary environment variables (PATH, HOME, etc.) are preserved.

```json
{
    "version": "1.0",
    "cache": {
        "enabled": true,
        "grammarSystem": "nfa",
        "matchWildcard": true,
        "matchEntityWildcard": true,
        "autoSave": true
    },
    "agents": [
        { "name": "player", "enabled": true },
        { "name": "list", "enabled": true },
        { "name": "calendar", "enabled": true }
    ]
}
```

Location: `<temp>/typeagent-sdk-wrapper-config/agentServerConfig.json`

## How to Test NFA Cache

### Prerequisites

1. **Agent server must be running** at ws://localhost:8999
2. Build both packages:
   ```bash
   cd packages/actionGrammar && npm run build
   cd ../agentSdkWrapper && npm run build
   ```

### Testing Workflow

#### Step 1: Start Agent Server

In one terminal, start the agent server:
```bash
cd packages/dispatcher
npm run shell
```

This starts the dispatcher with WebSocket server on port 8999.

#### Step 2: Start agentSdkWrapper with NFA Cache

In another terminal, start the SDK wrapper with NFA cache enabled:
```bash
cd packages/agentSdkWrapper
npm start -- --nfa-cache --debug
```

You should see:
```
[AgentSDK] NFA cache mode enabled - config: <path-to-config>
[AgentSDK] Model: claude-sonnet-4-5-20250929
[AgentSDK] Cache: enabled
```

#### Step 3: Send Initial Request

Send a request through the SDK wrapper:
```
> play Bohemian Rhapsody by Queen
```

**Expected behavior:**
- Request goes to agent server
- Agent server translates to action
- If translation succeeds, grammar rule is generated
- **Watch agent server console for grammar rule logging**

#### Step 4: Wait for Grammar Persistence

Wait ~120 seconds for the grammar store to auto-save to disk. The grammar store saves at:
```
~/.typeagent/sessions/<session-id>/grammars/dynamic.json
```

#### Step 5: Send Similar Request

Send a similar request to test generalization:
```
> play Stairway to Heaven by Led Zeppelin
```

**Expected behavior:**
- Request should hit the NFA grammar cache
- No new grammar rule generated (uses existing pattern)
- Faster response since it skips LLM translation

#### Step 6: Verify Cache Hit

You can verify cache hits by:
1. Checking agent server console for cache hit messages
2. Using the MCP server's `execute_command` with `cacheCheck: true`
3. Observing response times (cache hits are much faster)

## Monitoring Grammar Rules

### Agent Server Console Output

When a new grammar rule is added, you'll see in the **agent server console**:

```
[Grammar Cache] Added 1 new rule(s) to agent 'player':
--- New Grammar Rules ---
@play[action="play"] = {
    "play" @track[paramName="track", type="string"]
    "by" @artist[paramName="artist", type="string"]
}
--- Total rules: 15 ---
```

This output includes:
- Number of new rules added
- The agent name (e.g., 'player', 'list', 'calendar')
- The actual grammar rules in .agr format
- Total rule count for that agent

### Persisted Grammar Store

Grammar rules are saved to:
```
~/.typeagent/sessions/<session-id>/grammars/dynamic.json
```

You can inspect this file to see all persisted grammar rules.

## Testing Different Agents

### Player Agent
```
> play Imagine by John Lennon
> play hotel california by eagles
> pause the music
```

### List Agent
```
> add milk to my shopping list
> add eggs to my shopping list
> show my shopping list
```

### Calendar Agent
```
> schedule dentist appointment tomorrow at 3pm
> schedule team meeting next Monday at 2pm
> show my calendar
```

## Debugging

### Enable Debug Logging

Start with debug flag to see detailed cache operations:
```bash
npm start -- --nfa-cache --debug
```

Debug logs are written to:
```
~/.typeagent/logs/agent-sdk-wrapper-<timestamp>.log
```

### Check Configuration

Verify the config file was created:
```bash
# Windows
type %TEMP%\typeagent-sdk-wrapper-config\agentServerConfig.json

# Unix/Mac
cat /tmp/typeagent-sdk-wrapper-config/agentServerConfig.json
```

### Check Grammar Store

Inspect persisted grammar rules:
```bash
# Find your session directory
ls ~/.typeagent/sessions/

# View grammar rules
cat ~/.typeagent/sessions/<session-id>/grammars/dynamic.json
```

## Expected Cache Behavior

### First Request
- **Result**: CACHE_MISS (or no cache prefix)
- **Action**: LLM translates request → action
- **Grammar**: New rule generated and added
- **Console**: Grammar rule logged in agent server

### Exact Repeat (After 120s)
- **Result**: CACHE_HIT
- **Action**: Grammar cache matches → returns action
- **Grammar**: No new rule (exact match)
- **Console**: No grammar logging

### Similar Request (After 120s)
- **Result**: CACHE_HIT
- **Action**: Grammar cache generalizes → returns action
- **Grammar**: No new rule (pattern match)
- **Console**: No grammar logging

### Different Pattern
- **Result**: CACHE_MISS
- **Action**: LLM translates request → action
- **Grammar**: New rule generated for new pattern
- **Console**: New grammar rule logged

## Architecture Flow

```
User Input
    ↓
agentSdkWrapper (--nfa-cache)
    ↓ (creates config file)
    ↓ (sets AGENT_SERVER_CONFIG env var)
    ↓
MCP Server (commandExecutor)
    ↓ (reads config)
    ↓ (sends @config cache grammarSystem nfa)
    ↓
Agent Server (dispatcher)
    ↓ (configures NFA cache)
    ↓ (processes user request)
    ↓
Cache Check
    ├─ Cache Hit → Return cached action
    └─ Cache Miss → LLM Translation
            ↓
        Generate Grammar Rule
            ↓
        Add to AgentGrammarRegistry
            ↓
        [Grammar Cache] Logged to console ← YOU SEE THIS
            ↓
        Persist to dynamic.json (after 120s)
```

## Troubleshooting

### No Grammar Rules Logged

**Possible causes:**
1. Agent server not configured for NFA mode
   - Check agent server console for: `Grammar system set to 'nfa'.`
2. Request didn't result in successful translation
   - Check for error messages in agent server console
3. Grammar generation not triggered
   - Only single-action requests generate rules currently

**Solution:**
- Ensure agent server shows NFA configuration message
- Try a simple, clear request like "play Imagine by John Lennon"
- Check agent server console for errors

### Config File Not Found

**Error**: `Failed to load config`

**Solution:**
- Verify temp directory is writable
- Check debug logs for config file path
- Manually create config file and set `AGENT_SERVER_CONFIG`

### Agent Server Not Responding

**Error**: WebSocket connection failed

**Solution:**
- Ensure agent server is running on ws://localhost:8999
- Check `AGENT_SERVER_URL` environment variable
- Try restarting agent server

## Related Files

- [agentGrammarRegistry.ts](../../actionGrammar/src/agentGrammarRegistry.ts) - Grammar rule logging
- [cli.ts](./src/cli.ts) - NFA cache flag and config generation
- [commandServer.ts](../commandExecutor/src/commandServer.ts) - Config application
- [cache.ts](../../cache/src/cache/cache.ts) - Grammar generation logic
- [nfaCacheIntegration.spec.ts](../commandExecutor/test/nfaCacheIntegration.spec.ts) - Integration test example

## Next Steps

1. **Test cache effectiveness** - Run multiple similar requests and observe hit rates
2. **Monitor grammar rule quality** - Inspect generated rules for correctness
3. **Test across agents** - Try player, list, and calendar agents
4. **Measure performance** - Compare cache hit vs miss response times
5. **Iterate on patterns** - Test various request patterns to build cache coverage
