# Dynamic Grammar Loading

This document describes the dynamic grammar loading system that enables runtime addition of generated grammar rules to an in-memory grammar cache.

## Overview

The dynamic loading system allows grammar rules generated from user request/action pairs (via `grammarGenerator` in `agentSdkWrapper`) to be immediately added to the grammar cache, making them available for matching new user requests without requiring a restart or recompilation.

## Architecture

### Components

1. **grammarGenerator** (in `agentSdkWrapper`) - Analyzes request/action pairs and generates grammar rules
2. **DynamicGrammarLoader** - Parses, validates, and merges generated rules into existing grammars
3. **DynamicGrammarCache** - Maintains in-memory grammar and compiled NFA for efficient matching
4. **grammarMerger** - Utilities for combining grammar rules

### Flow

```
User Request + Action
       ↓
grammarGenerator.generateGrammar()
       ↓
grammarGenerator.formatAsGrammarRule()
       ↓
.agr format text
       ↓
DynamicGrammarLoader.loadAndMerge()
       ↓
Parse → Validate Symbols → Merge → Compile NFA
       ↓
DynamicGrammarCache (updated)
       ↓
Available for matching immediately
```

## Usage

### Basic Example

```typescript
import { DynamicGrammarCache } from "./dynamicGrammarLoader.js";
import { compileGrammarToNFA } from "./nfaCompiler.js";
import { registerBuiltInSymbols } from "./symbols/index.js";

// Initialize symbols
registerBuiltInSymbols();

// Start with base grammar
const baseGrammar: Grammar = {
  rules: [
    {
      parts: [{ type: "string", value: ["pause"] }],
    },
  ],
};
const baseNFA = compileGrammarToNFA(baseGrammar, "base");

// Create cache
const cache = new DynamicGrammarCache(baseGrammar, baseNFA);

// Add generated rule dynamically
const generatedRule = `@ <play> = play $(track:string) by $(artist:string)`;
const result = cache.addRules(generatedRule);

if (result.success) {
  console.log("Rule added successfully!");
  console.log(`Grammar now has ${cache.getStats().ruleCount} rules`);
} else {
  console.error("Failed to add rule:", result.errors);
}

// Use the updated cache for matching
import { matchNFA } from "./nfaInterpreter.js";
const matchResult = matchNFA(cache.getNFA(), ["play", "Song", "by", "Artist"]);
console.log(matchResult.matched); // true
```

### Integration with grammarGenerator

```typescript
import { ClaudeGrammarGenerator } from "agentSdkWrapper/grammarGenerator.js";
import { DynamicGrammarCache } from "./dynamicGrammarLoader.js";

const generator = new ClaudeGrammarGenerator();
const cache = new DynamicGrammarCache(initialGrammar, initialNFA);

// User makes a request
const testCase = {
  request: "play Shake It Off by Taylor Swift",
  action: {
    actionName: "playTrack",
    parameters: {
      trackName: "Shake It Off",
      artist: "Taylor Swift",
    },
  },
};

// Generate grammar from example
const analysis = await generator.generateGrammar(testCase, schemaInfo);

if (analysis.shouldGenerateGrammar) {
  // Format as .agr rule
  const agrRule = generator.formatAsGrammarRule(testCase, analysis);

  // Add to cache
  const result = cache.addRules(agrRule);

  if (result.success) {
    console.log("Grammar updated! Similar requests will now match.");
  } else {
    console.error("Failed to add rule:", result.errors);
    if (result.unresolvedSymbols) {
      console.error("Unresolved symbols:", result.unresolvedSymbols);
    }
  }
}
```

## Symbol Resolution

### Validation

Before loading, the system validates that all referenced symbols are resolved:

```typescript
const loader = new DynamicGrammarLoader();

// Rule references CalendarDate symbol
const rule = `@ <schedule> = schedule $(event:string) on $(date:CalendarDate)`;

const result = loader.load(rule);

if (!result.success) {
  console.log("Unresolved symbols:", result.unresolvedSymbols);
  // Output: ["CalendarDate"]
}
```

### Resolution Requirements

A symbol is considered resolved if:

1. It's a built-in type (`string`, `number`)
2. It's registered in `globalSymbolRegistry`

To make a symbol available for dynamic loading:

```typescript
import { globalSymbolRegistry } from "./symbolModule.js";
import { CalendarDate } from "./symbols/calendarDate.js";

// Register before loading grammars that reference it
globalSymbolRegistry.registerConverter("CalendarDate", CalendarDate);
```

Or use the built-in registration:

```typescript
import { registerBuiltInSymbols } from "./symbols/index.js";

// Registers Global.Ordinal, Global.Cardinal, Calendar.CalendarDate, etc.
registerBuiltInSymbols();
```

## Merging Rules

### Simple Merge

Rules are added as alternatives at the top level:

```typescript
// Existing: pause
// New: play $(track:string)
// Result: Grammar with 2 rules (both alternatives)
```

### Multiple Rules for Same Action

When multiple rules target the same action, they become alternatives:

```typescript
const cache = new DynamicGrammarCache(baseGrammar, baseNFA);

// Add first play pattern
cache.addRules(`@ <play> = play $(track:string)`);

// Add second play pattern (alternative)
cache.addRules(`@ <play> = play $(track:string) by $(artist:string)`);

// Both patterns now work
const result1 = matchNFA(cache.getNFA(), ["play", "Song"]);
// matched: true

const result2 = matchNFA(cache.getNFA(), ["play", "Song", "by", "Artist"]);
// matched: true
```

## Error Handling

### Parse Errors

```typescript
const result = cache.addRules(`@ <invalid> = this is not valid grammar`);

if (!result.success) {
  console.error("Parse errors:", result.errors);
  // Cache remains unchanged
}
```

### Unresolved Symbols

```typescript
const result = cache.addRules(
  `@ <schedule> = schedule $(event:string) on $(date:UnknownType)`,
);

if (!result.success) {
  console.error("Errors:", result.errors);
  console.log("Unresolved:", result.unresolvedSymbols);
  // Output: ["UnknownType"]
  // Cache remains unchanged
}
```

### NFA Compilation Errors

```typescript
// If the merged grammar can't compile to NFA
const result = cache.addRules(invalidRule);

if (!result.success) {
  console.error("Compilation failed:", result.errors);
  // Cache remains unchanged
}
```

## Cache Management

### Statistics

```typescript
const cache = new DynamicGrammarCache(baseGrammar, baseNFA);

const stats = cache.getStats();
console.log(`Rules: ${stats.ruleCount}`);
console.log(`NFA States: ${stats.stateCount}`);
console.log(`NFA Transitions: ${stats.transitionCount}`);
```

### Accessing Current State

```typescript
// Get current grammar
const grammar = cache.getGrammar();

// Get current NFA
const nfa = cache.getNFA();

// Use for matching
import { matchNFA } from "./nfaInterpreter.js";
const result = matchNFA(nfa, tokens);
```

## Advanced Usage

### Batch Loading

```typescript
const loader = new DynamicGrammarLoader();

// Load multiple rules at once
const agrText = `
@ <play> = play $(track:string)
@ <play> = play $(track:string) by $(artist:string)
@ <pause> = pause
@ <resume> = resume
`;

const result = loader.load(agrText);

if (result.success) {
  const cache = new DynamicGrammarCache(result.grammar!, result.nfa!);
  // Cache ready with all rules
}
```

### Incremental Updates

```typescript
const cache = new DynamicGrammarCache(baseGrammar, baseNFA);

// As users make requests, incrementally add rules
function handleUserRequest(request: string, action: Action) {
  // Generate grammar for this request/action pair
  const analysis = await generator.generateGrammar(testCase, schemaInfo);

  if (analysis.shouldGenerateGrammar) {
    const rule = generator.formatAsGrammarRule(testCase, analysis);

    // Add to cache immediately
    const result = cache.addRules(rule);

    if (result.success) {
      // Similar requests will now match from cache
      console.log("Grammar learned from this example");
    }
  }

  // Execute the action
  executeAction(action);
}
```

### Validation Before Loading

```typescript
const loader = new DynamicGrammarLoader();

// Check what symbols would be needed
function checkSymbolRequirements(agrText: string): string[] {
  const errors: string[] = [];
  const grammar = loadGrammarRules("<check>", agrText, errors);

  if (!grammar) {
    return []; // Parse error
  }

  // Validate symbols
  const result = loader.load(agrText);
  return result.unresolvedSymbols || [];
}

const unresolved = checkSymbolRequirements(generatedRule);
if (unresolved.length > 0) {
  console.log("Need to register symbols:", unresolved);
  // Register them first
  for (const symbol of unresolved) {
    registerSymbol(symbol);
  }
}

// Now safe to load
cache.addRules(generatedRule);
```

## Example: Complete Workflow

```typescript
import { DynamicGrammarCache } from "./dynamicGrammarLoader.js";
import { compileGrammarToNFA } from "./nfaCompiler.js";
import { matchNFA } from "./nfaInterpreter.js";
import { registerBuiltInSymbols } from "./symbols/index.js";
import { ClaudeGrammarGenerator } from "agentSdkWrapper/grammarGenerator.js";

// 1. Initialize
registerBuiltInSymbols();

// 2. Start with base grammar
const baseGrammar: Grammar = { rules: [] };
const baseNFA = compileGrammarToNFA(baseGrammar, "base");
const cache = new DynamicGrammarCache(baseGrammar, baseNFA);

// 3. Create generator
const generator = new ClaudeGrammarGenerator();

// 4. User makes a request
const userRequest = "play Shake It Off by Taylor Swift";

// 5. Execute action (assume this happens)
const action = {
  actionName: "playTrack",
  parameters: {
    trackName: "Shake It Off",
    artist: "Taylor Swift",
  },
};

// 6. Learn from this example
const testCase = { request: userRequest, action };
const analysis = await generator.generateGrammar(testCase, schemaInfo);

if (analysis.shouldGenerateGrammar) {
  const rule = generator.formatAsGrammarRule(testCase, analysis);
  const result = cache.addRules(rule);

  if (result.success) {
    console.log("✓ Grammar updated");
    console.log(`Pattern: ${analysis.grammarPattern}`);
  }
}

// 7. Next similar request matches from cache
const similarRequest = "play Bad Blood by Taylor Swift";
const tokens = similarRequest.split(" ");
const matchResult = matchNFA(cache.getNFA(), tokens);

if (matchResult.matched) {
  console.log("✓ Matched from cache!");
  console.log("trackName:", matchResult.captures.get("trackName"));
  console.log("artist:", matchResult.captures.get("artist"));
  // Execute without needing LLM
}
```

## Performance Considerations

### NFA Compilation

Each time rules are added, the entire grammar is recompiled to an NFA. For large grammars with frequent updates:

1. **Batch updates** - Combine multiple rules before adding
2. **Cache NFA** - Reuse the compiled NFA until updates are needed
3. **DFA compilation** (future) - Will provide faster matching than NFA interpretation

### Memory Usage

The cache maintains both the grammar and compiled NFA in memory. For large-scale deployments:

1. Monitor cache size via `getStats()`
2. Consider persisting learned rules to disk
3. Implement cache eviction policies if needed

## Future Enhancements

### DFA Compilation

When DFA compilation is implemented, the cache will automatically use DFAs:

```typescript
const result = cache.addRules(rule);
// result.dfa will be available
// Matching will use DFA for better performance
```

### Persistence

```typescript
// Save learned rules
const rules = cache.getGrammar().rules;
saveToFile("learned-rules.agr", serializeRules(rules));

// Load on startup
const savedRules = loadFromFile("learned-rules.agr");
cache.addRules(savedRules);
```

### Analytics

```typescript
// Track which rules are used most
const analytics = cache.getMatchAnalytics();
console.log("Most used patterns:", analytics.topPatterns);
```

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
