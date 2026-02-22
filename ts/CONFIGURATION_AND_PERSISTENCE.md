# Configuration and Grammar Persistence System

This document describes how the TypeAgent configuration system works, how dynamically generated grammar rules are persisted, and how Claude interacts with TypeAgent through the MCP server.

## Overview

TypeAgent provides two cache systems for learning natural language patterns:

| System              | Type                              | Storage                    | Use Case                                         |
| ------------------- | --------------------------------- | -------------------------- | ------------------------------------------------ |
| **completionBased** | Construction cache with wildcards | `<session>/constructions/` | Flexible pattern matching, handling variations   |
| **nfa**             | Compiled NFA with Action Grammar  | `<session>/grammars/`      | Precise matching, complex patterns, entity types |

**Current Status**:

- ✅ Both systems fully functional
- ✅ Runtime switching via `@config cache.grammarSystem`
- ✅ File-based configuration for MCP server startup
- ✅ **Automatic cache population** (no user confirmation required)
- 🔄 Future: Permissions system for user confirmation

**Key Integration Points**:

1. **MCP Server** (commandExecutor): Exposes tools for Claude to call TypeAgent
2. **Action Command Handler** (dispatcher): Handles `@action` commands with automatic cache population
3. **Grammar Store** (actionGrammar): Persists NFA grammar rules per-session
4. **Construction Store** (agent-cache): Persists completion-based constructions per-session

## Configuration System

### Overview

The configuration system allows control of:

- **Active Agents**: Which agents are enabled
- **Grammar System Selection**: Choose between `completionBased` (existing cache) or `nfa` (new grammar registry)
- **Cache Behavior**: Wildcard matching, conflict caching, etc.

### Configuration File Format

Create `agentServerConfig.json` in one of these locations (in order of precedence):

1. `$AGENT_SERVER_CONFIG` environment variable
2. `./agentServerConfig.json` (current working directory)
3. `./.agentServerConfig.json` (hidden file in current directory)
4. `~/.typeagent/agentServerConfig.json` (user config directory)
5. `~/.agentServerConfig.json` (user home directory)
6. `$TYPEAGENT_INSTANCE_DIR/agentServerConfig.json` (if set)

```json
{
  "version": "1.0",
  "cache": {
    "enabled": true,
    "grammarSystem": "nfa",
    "matchWildcard": false,
    "matchEntityWildcard": false,
    "mergeMatchSets": true,
    "cacheConflicts": false
  },
  "agents": [
    {
      "name": "player",
      "enabled": true,
      "grammarFile": "./packages/agents/player/src/agent/playerSchema.agr"
    },
    {
      "name": "calendar",
      "enabled": true,
      "grammarFile": "./packages/agents/calendar/dist/calendarSchema.agr"
    }
  ],
  "dispatcher": {
    "persistSession": true,
    "persistDir": "~/.typeagent",
    "metrics": true,
    "dbLogging": false
  }
}
```

### Configuration Flow

```
┌─────────────────┐
│  Config File    │
│ (JSON)          │
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│  MCP Server     │  ← Loads config on startup
│  (CommandServer)│  ← Sends @config commands
└────────┬────────┘
         │
         ↓ @config cache.grammarSystem nfa
         ↓ @config agent player on
┌─────────────────┐
│  AgentServer    │
│  (Dispatcher)   │  ← Applies configuration
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│  Session Config │  ← Persisted per session
└─────────────────┘
```

### Testing Configuration

```bash
# Create test configuration
cat > agentServerConfig.json <<EOF
{
  "version": "1.0",
  "cache": {
    "grammarSystem": "nfa"
  }
}
EOF

# Test loading (from commandExecutor package)
cd packages/commandExecutor
node test-config-loading.mjs
```

### Runtime Commands

Configure the system at runtime using `@config` commands:

```
# Switch grammar systems
@config cache.grammarSystem nfa
@config cache.grammarSystem completionBased

# Enable/disable agents
@config agent player on
@config agent calendar off

# Check current configuration
@config
```

## Grammar Persistence System

### Overview

The Grammar Store (`GrammarStore`) manages persistence of dynamically generated grammar rules, similar to how `ConstructionStore` manages the existing cache.

### Directory Structure

Grammar rules are stored per-session:

```
~/.typeagent/sessions/
  └── 2026-01-25-001/           # Session directory
      ├── data.json             # Session metadata
      ├── constructions/        # Existing cache system
      │   └── default.json
      └── grammars/             # NEW: Dynamic grammar storage
          └── dynamic.json      # Generated grammar rules
```

### Grammar Store File Format

The `dynamic.json` file contains all dynamically learned rules:

```json
{
  "version": "1.0",
  "schemas": {
    "player": [
      {
        "grammarText": "<playTrack> = \"play\" $(trackName:string) \"by\" $(artistName:string)",
        "timestamp": 1737850800000,
        "sourceRequest": "play Bohemian Rhapsody by Queen",
        "actionName": "playTrack",
        "schemaName": "player"
      },
      {
        "grammarText": "<pause> = \"pause\" (\"the\")? (\"music\")?",
        "timestamp": 1737850900000,
        "sourceRequest": "pause music",
        "actionName": "pause",
        "schemaName": "player"
      }
    ],
    "calendar": [
      {
        "grammarText": "<scheduleEvent> = \"schedule\" $(event:string) $(time:CalendarTime)",
        "timestamp": 1737851000000,
        "sourceRequest": "schedule meeting tomorrow at 2pm",
        "actionName": "scheduleEvent",
        "schemaName": "calendar"
      }
    ]
  }
}
```

### Using Grammar Store

```typescript
import { GrammarStore, getSessionGrammarStorePath } from "action-grammar";

// Create or load grammar store
const store = new GrammarStore();
await store.load(getSessionGrammarStorePath(sessionDir));

// Enable auto-save
await store.setAutoSave(true);

// Add a new rule (auto-saves if enabled)
await store.addRule({
  grammarText: '<playTrack> = "play" $(track:string)',
  schemaName: "player",
  sourceRequest: "play music",
  actionName: "playTrack",
});

// Query rules
const playerRules = store.getRulesForSchema("player");
console.log(`Player has ${playerRules.length} rules`);

// Export as .agr file
const agrFile = store.exportSchemaGrammar("player");
fs.writeFileSync("player-dynamic.agr", agrFile);

// Compile to Grammar object for loading into registry
const grammar = store.compileToGrammar();
if (grammar) {
  // Load into agent grammar registry
  agentRegistry.addGrammar("player", grammar);
}
```

### Integration with Cache Population

**Current Status**: Automatic cache population without user confirmation.

When a request/action pair executes successfully (no errors or clarifying questions), the system automatically populates the cache based on the configured grammar system:

#### Via MCP Server (commandExecutor)

Claude uses the `typeagent_action` MCP tool to execute actions with cache population:

```typescript
// Claude calls typeagent_action with the user's natural language request
const result = await typeagent_action({
  agent: "player",
  action: "playTrack",
  parameters: {
    trackName: "Bohemian Rhapsody",
    artistName: "Queen",
  },
  naturalLanguage: "play Bohemian Rhapsody by Queen", // REQUIRED
});

// This sends to dispatcher:
// @action player playTrack --parameters '{"trackName":"..."}' --naturalLanguage 'play Bohemian Rhapsody by Queen'
```

#### In Action Command Handler (dispatcher)

The `@action` command handler (`actionCommandHandler.ts`) automatically populates cache:

```typescript
// After successful action execution
if (naturalLanguage !== undefined && naturalLanguage.trim() !== "") {
    await this.populateCache(systemContext, naturalLanguage, action);
}

// populateCache() checks grammarSystem config and routes accordingly:
private async populateCache(context, naturalLanguage, action) {
    const grammarSystem = context.session.getConfig().cache.grammarSystem;

    if (grammarSystem === "nfa") {
        // NEW: Use action-grammar generation
        const result = await populateCache({
            request: naturalLanguage,
            schemaName: action.schemaName,
            action: {
                actionName: action.actionName,
                parameters: action.parameters
            },
            schemaPath: getSchemaPath(action.schemaName)
        });

        if (result.success) {
            // Add to session's GrammarStore
            await grammarStore.addRule({
                grammarText: result.generatedRule!,
                schemaName: action.schemaName,
                sourceRequest: naturalLanguage,
                actionName: action.actionName
            });

            // Reload into NFA registry
            const grammar = grammarStore.compileToGrammar();
            if (grammar) {
                agentRegistry.addGrammar(action.schemaName, grammar);
            }
        }
    } else {
        // EXISTING: Use construction cache (completionBased)
        await context.agentCache.processRequestAction(requestAction, true, options);
    }
}
```

#### Future: User Confirmation with Permissions

Later, a permissions system will enable Claude to query users before populating cache:

```typescript
// Future: With permissions system
if (needsUserConfirmation(action)) {
    const confirmed = await askUser("Cache this pattern?");
    if (!confirmed) return;
}
await populateCache(...);
```

### Complete Cache Population Flow

```
┌────────────────────────────────────────────────────────────────────┐
│                    User Request via Claude                         │
│                 "play Bohemian Rhapsody by Queen"                  │
└────────────────────────────┬───────────────────────────────────────┘
                             │
                             ↓
┌────────────────────────────────────────────────────────────────────┐
│                  Claude (MCP Client)                               │
│  Calls: typeagent_action({                                         │
│    agent: "player",                                                │
│    action: "playTrack",                                            │
│    parameters: {...},                                              │
│    naturalLanguage: "play Bohemian Rhapsody by Queen"              │
│  })                                                                │
└────────────────────────────┬───────────────────────────────────────┘
                             │
                             ↓
┌────────────────────────────────────────────────────────────────────┐
│               MCP Server (commandExecutor)                         │
│  Formats command:                                                  │
│  @action player playTrack \                                        │
│    --parameters '{"trackName":"..."}' \                            │
│    --naturalLanguage 'play Bohemian Rhapsody by Queen'             │
│                                                                    │
│  Sends to: dispatcher.processCommand(actionCommand)                │
└────────────────────────────┬───────────────────────────────────────┘
                             │
                             ↓
┌────────────────────────────────────────────────────────────────────┐
│            Action Command Handler (dispatcher)                     │
│  1. Validates schema and action                                    │
│  2. Executes action: await executeActions(...)                     │
│  3. If naturalLanguage provided: await populateCache(...)          │
└────────────────────────────┬───────────────────────────────────────┘
                             │
                             ↓
                  ┌──────────┴──────────┐
                  │ Grammar System?     │
                  └──────────┬──────────┘
                             │
          ┌──────────────────┴──────────────────┐
          │                                     │
          ↓                                     ↓
┌─────────────────────┐              ┌─────────────────────┐
│ completionBased     │              │       nfa           │
│ (Existing System)   │              │  (New System)       │
└──────────┬──────────┘              └──────────┬──────────┘
           │                                    │
           ↓                                    ↓
┌─────────────────────┐              ┌─────────────────────┐
│ processRequestAction│              │ populateCache()     │
│ (agent-cache)       │              │ (action-grammar)    │
│                     │              │                     │
│ • Generates         │              │ • Calls Claude to   │
│   construction      │              │   analyze pattern   │
│ • Stores in:        │              │ • Generates .agr    │
│   constructions/    │              │   grammar rule      │
│   default.json      │              │ • Returns result    │
└──────────┬──────────┘              └──────────┬──────────┘
           │                                    │
           │                                    ↓
           │                         ┌─────────────────────┐
           │                         │ GrammarStore.addRule│
           │                         │                     │
           │                         │ • Adds metadata     │
           │                         │ • Auto-saves to:    │
           │                         │   grammars/         │
           │                         │   dynamic.json      │
           │                         └──────────┬──────────┘
           │                                    │
           │                                    ↓
           │                         ┌─────────────────────┐
           │                         │ Reload into NFA     │
           │                         │ Registry            │
           │                         │                     │
           │                         │ • Compile grammar   │
           │                         │ • Add to agent      │
           │                         │   grammar registry  │
           │                         └─────────────────────┘
           │                                    │
           └────────────────┬───────────────────┘
                            │
                            ↓
                 ┌─────────────────────┐
                 │ Cache Populated     │
                 │                     │
                 │ Next time user says │
                 │ similar phrase:     │
                 │ → Direct match      │
                 │ → No Claude call    │
                 └─────────────────────┘
```

### Session Lifecycle

```
┌──────────────────────────────────────────────────────────────┐
│                     Session Start                            │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ↓
         ┌─────────────────────────┐
         │ Load Session Directory  │
         └─────────┬───────────────┘
                   │
                   ├──→ Load constructions/default.json (completionBased cache)
                   │
                   └──→ Load grammars/dynamic.json (NFA cache)
                           │
                           ↓
                   ┌───────────────────────┐
                   │ Compile Grammar Rules │
                   └──────────┬────────────┘
                              │
                              ↓
                   ┌───────────────────────┐
                   │ Load into NFA Registry│
                   └──────────┬────────────┘
                              │
                              ↓
                   ┌───────────────────────┐
                   │  Ready for Matching   │
                   └───────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                  During Session                              │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ↓
         ┌─────────────────────────┐
         │ Claude Calls Tool       │
         │ typeagent_action        │
         └─────────┬───────────────┘
                   │
                   ↓
         ┌─────────────────────────┐
         │ Action Executes         │
         └─────────┬───────────────┘
                   │
                   ├─ Error/Question → No cache population
                   │
                   └─ Success → Automatic cache population
                            │
                            ↓
                   ┌────────────────────┐
                   │ Add to Cache       │ ← Automatic (no user confirmation)
                   │ (GrammarStore or   │
                   │  ConstructionStore)│
                   └────────┬───────────┘
                            │
                            ↓
                   ┌────────────────────┐
                   │ Reload into Registry│ ← For NFA only
                   └────────────────────┘
```

## Switching Grammar Systems

### Completion-Based System (Existing)

- Uses construction cache with wildcard matching
- Stored in `<session>/constructions/`
- Good for: Flexible pattern matching, handling variations

```json
{
  "cache": {
    "grammarSystem": "completionBased"
  }
}
```

### NFA System (New)

- Uses compiled NFA with Action Grammar rules
- Dynamic rules stored in `<session>/grammars/`
- Good for: Precise matching, complex patterns, entity types

```json
{
  "cache": {
    "grammarSystem": "nfa"
  }
}
```

### Hybrid Approach

Both systems can coexist:

1. Use NFA for precise, high-confidence matches
2. Fall back to completion-based for flexible matching
3. Learn new patterns and add to NFA over time

## MCP Server Tools

The commandExecutor MCP server exposes the following tools for Claude to interact with TypeAgent:

### execute_command

Legacy natural language command execution with cache checking.

```typescript
{
    request: string;      // The command to execute
    cacheCheck?: boolean; // Check cache before executing
    confirmed?: boolean;  // User confirmation for destructive commands
}
```

**Use cases**: Music playback, lists, calendar, VSCode automation

**Confirmation flow**: Some commands require user confirmation. If the tool returns an error indicating confirmation is needed, ask the user and retry with `confirmed: true`.

### discover_schemas

Check if TypeAgent has capabilities for a user request not covered by existing tools.

```typescript
{
    query: string;           // Natural language description (e.g., "weather")
    includeActions?: boolean; // Return detailed action schemas (default: false)
}
```

**Use case**: Before telling user a capability isn't available, check if an agent exists

**Example**: User asks "What's the weather?" → Call `discover_schemas({query: "weather"})` to see if weather agent is available

### load_schema

Dynamically load a schema and register its actions as tools in the current session.

```typescript
{
    schemaName: string;  // Schema name from discover_schemas
    exposeAs?: string;   // "individual" | "composite" (default: composite)
}
```

**Use case**: Make rarely-used agent actions available for repeated invocation

**Note**: Only use after `discover_schemas` confirms schema availability

### typeagent_action ⭐

**PRIMARY TOOL**: Execute a TypeAgent action with automatic cache population.

```typescript
{
    agent: string;           // Schema/agent name (e.g., "player", "calendar")
    action: string;          // Action name (e.g., "playTrack", "scheduleEvent")
    parameters?: object;     // Action-specific parameters
    naturalLanguage: string; // REQUIRED: User's original natural language request
}
```

**Cache Population**: This tool automatically populates TypeAgent's cache so future similar requests execute faster. The `naturalLanguage` parameter MUST contain the user's exact original request.

**Example**:

```typescript
// User: "play Bohemian Rhapsody by Queen"
await typeagent_action({
  agent: "player",
  action: "playTrack",
  parameters: {
    trackName: "Bohemian Rhapsody",
    artistName: "Queen",
  },
  naturalLanguage: "play Bohemian Rhapsody by Queen", // User's exact phrase
});
```

**When to use**:

1. Action exists but isn't exposed as individual tool
2. Invoking newly discovered action before loading schema
3. Rarely-used action that doesn't warrant dedicated tool

**Result**: Action executes AND pattern is cached based on `grammarSystem` setting (completionBased or NFA).

## Command Reference

### Configuration Commands

```bash
# Grammar system selection
@config cache.grammarSystem nfa
@config cache.grammarSystem completionBased

# Agent management
@config agent player on
@config agent calendar off
@config agent                   # Show all agents

# Cache behavior
@config cache.enabled on
@config match.grammar on
```

### Grammar CLI Tools

```bash
# Test single pattern
test-grammar -s schema.pas.json \\
  -r "play music" \\
  -a playTrack \\
  -p '{"track":"music"}'

# Generate complete grammar from schema
generate-grammar schema.pas.json -o output.agr

# Extend existing grammar
generate-grammar -i existing.agr schema.pas.json
```

## Automatic Cache Population Behavior

### Current Implementation (No User Confirmation)

**When cache population happens**:

- ✅ Action executes successfully
- ✅ No errors occurred
- ✅ No clarifying questions needed
- ✅ `naturalLanguage` parameter was provided

**When cache population does NOT happen**:

- ❌ Action execution failed with error
- ❌ Action returned clarifying question
- ❌ Caching disabled for schema
- ❌ Explanation/cache globally disabled

### For Claude (MCP Client)

Claude should ALWAYS pass the user's exact original natural language request in the `naturalLanguage` parameter when calling `typeagent_action`:

```typescript
// ✅ CORRECT: Pass user's exact phrase
await typeagent_action({
  agent: "player",
  action: "playTrack",
  parameters: { trackName: "Imagine", artistName: "John Lennon" },
  naturalLanguage: "play Imagine by John Lennon", // User's exact words
});

// ❌ WRONG: Don't paraphrase or describe
naturalLanguage: "execute playTrack action"; // Too generic
naturalLanguage: "user wants to play a song"; // Paraphrased
```

**Why this matters**: The `naturalLanguage` parameter trains the cache so future similar requests can be handled directly without Claude invocation, making the system faster and more efficient.

### Future: Permissions-Based Confirmation

A permissions system will be added to allow Claude to query users before populating cache:

```typescript
// Future capability
if (requiresPermission(action)) {
  const confirmed = await askUserForCachePermission({
    request: naturalLanguage,
    action: action,
    schemaName: schemaName,
  });
  if (!confirmed) {
    return; // Don't populate cache
  }
}
```

This will enable fine-grained control over which patterns get cached.

## Best Practices

1. **Start with NFA**: Use `grammarSystem: "nfa"` for new agents
2. **Enable Auto-Save**: Set `autoSave: true` on GrammarStore
3. **Monitor Rule Count**: Check `grammarStore.getInfo()` periodically
4. **Export for Review**: Use `exportSchemaGrammar()` to audit rules
5. **Session Cleanup**: Archive old session grammars periodically
6. **Test Patterns**: Use `test-grammar` CLI before committing rules
7. **Always Pass Natural Language**: When using `typeagent_action` MCP tool, ALWAYS include user's exact request
8. **Let Cache Populate**: Don't disable automatic cache population unless necessary

## Troubleshooting

### Grammar Not Loading

Check session directory structure:

```bash
ls -la ~/.typeagent/sessions/$(ls -t ~/.typeagent/sessions | head -1)/grammars/
```

### Configuration Not Applied

Verify config file location:

```bash
cd packages/commandExecutor
node test-config-loading.mjs
```

### Rules Not Matching

1. Export grammar: `store.exportSchemaGrammar("player")`
2. Test with test-grammar CLI
3. Check for syntax errors in grammar text
4. Verify entity types are registered

## Future Enhancements

- **Rule Merging**: Automatically combine similar patterns
- **Conflict Detection**: Warn about overlapping rules
- **Usage Statistics**: Track which rules match most often
- **Rule Optimization**: Simplify complex patterns
- **Cross-Session Learning**: Share rules across sessions

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
