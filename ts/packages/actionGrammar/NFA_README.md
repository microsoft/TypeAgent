# NFA Infrastructure for Regular Grammars

This infrastructure provides a token-based NFA (Nondeterministic Finite Automaton) system for compiling and matching regular grammars.

## Overview

The NFA infrastructure consists of three main components:

1. **NFA Types** (`nfa.ts`) - Core data structures for representing NFAs
2. **NFA Compiler** (`nfaCompiler.ts`) - Compiles grammars to NFAs
3. **NFA Interpreter** (`nfaInterpreter.ts`) - Runs NFAs against token sequences for debugging

## Key Features

- **Token-based**: Works with tokens (words/symbols) as atomic units, not characters
- **Debugging support**: Interpret NFAs directly to trace execution
- **Grammar combination**: Combine multiple NFAs using sequence or choice operations
- **Variable capture**: Capture wildcard matches and numbers into variables
- **Extensible**: Foundation for DFA compilation (future work)

## Usage

### Basic Example: Compile and Match

```typescript
import { Grammar } from "./grammarTypes.js";
import { compileGrammarToNFA } from "./nfaCompiler.js";
import { matchNFA } from "./nfaInterpreter.js";

// Define a grammar
const grammar: Grammar = {
  rules: [
    {
      parts: [
        { type: "string", value: ["hello"] },
        { type: "wildcard", variable: "name", typeName: "string" },
      ],
    },
  ],
};

// Compile to NFA
const nfa = compileGrammarToNFA(grammar, "greeting");

// Match against tokens
const result = matchNFA(nfa, ["hello", "Alice"]);

console.log(result.matched); // true
console.log(result.captures.get("name")); // "Alice"
```

### Grammar with Alternatives

```typescript
const grammar: Grammar = {
  rules: [
    {
      parts: [{ type: "string", value: ["hello"] }],
    },
    {
      parts: [{ type: "string", value: ["hi"] }],
    },
  ],
};

const nfa = compileGrammarToNFA(grammar, "greeting");

matchNFA(nfa, ["hello"]); // { matched: true, ... }
matchNFA(nfa, ["hi"]); // { matched: true, ... }
matchNFA(nfa, ["bye"]); // { matched: false, ... }
```

### Grammar with Sequence

```typescript
const grammar: Grammar = {
  rules: [
    {
      parts: [
        { type: "string", value: ["start"] },
        { type: "wildcard", variable: "command", typeName: "string" },
        { type: "string", value: ["end"] },
      ],
    },
  ],
};
```

### Optional Parts

```typescript
const grammar: Grammar = {
  rules: [
    {
      parts: [
        { type: "string", value: ["hello"] },
        {
          type: "wildcard",
          variable: "name",
          typeName: "string",
          optional: true, // Can be skipped
        },
      ],
    },
  ],
};

const nfa = compileGrammarToNFA(grammar);

matchNFA(nfa, ["hello", "Alice"]); // matches, captures name="Alice"
matchNFA(nfa, ["hello"]); // also matches, no capture
```

### Combining NFAs

```typescript
import { combineNFAs } from "./nfa.js";

const nfa1 = compileGrammarToNFA(grammar1);
const nfa2 = compileGrammarToNFA(grammar2);

// Sequence: match nfa1 then nfa2
const sequential = combineNFAs(nfa1, nfa2, "sequence");

// Choice: match either nfa1 or nfa2
const alternative = combineNFAs(nfa1, nfa2, "choice");
```

### Debugging with NFA Interpreter

```typescript
import { matchNFA, printNFA, printMatchResult } from "./nfaInterpreter.js";

const nfa = compileGrammarToNFA(grammar, "my-grammar");

// Print NFA structure
console.log(printNFA(nfa));
/* Output:
NFA: my-grammar
  Start state: 0
  Accepting states: [2]
  States (3):
    State 0:
      ε -> 1
    State 1:
      [hello] -> 2
    State 2 [ACCEPT]:
      (no transitions)
*/

// Match with debugging enabled
const result = matchNFA(nfa, ["hello"], true);
console.log(printMatchResult(result, ["hello"]));
/* Output:
Match result: SUCCESS
Tokens consumed: 1/1
Visited states: [0, 1, 2]
*/
```

### Number Matching

```typescript
const grammar: Grammar = {
  rules: [
    {
      parts: [
        { type: "string", value: ["count"] },
        { type: "number", variable: "n" },
      ],
    },
  ],
};

const nfa = compileGrammarToNFA(grammar);

const result = matchNFA(nfa, ["count", "42"]);
console.log(result.matched); // true
console.log(result.captures.get("n")); // 42 (as number)
```

## Architecture

### NFA Structure

An NFA consists of:

- **States**: Nodes in the automaton with unique IDs
- **Transitions**: Edges between states, can be:
  - `token`: Match specific token(s)
  - `epsilon`: Free transition (no input consumed)
  - `wildcard`: Match any token (for variables)
- **Start state**: Where matching begins
- **Accepting states**: States where matching succeeds

### Compilation Strategy

The compiler converts grammar rules to NFAs using these patterns:

1. **String parts** → Token transitions
2. **Wildcards** → Wildcard transitions with variable capture
3. **Numbers** → Wildcard transitions with type constraint
4. **Rule alternatives** → Epsilon branches from start state
5. **Sequences** → Chain states with transitions
6. **Optional parts** → Add epsilon bypass transition

### Token-Based Matching

Unlike character-based regex engines, this NFA works at the token level:

- Input is an array of strings (tokens)
- Each transition consumes one token (except epsilon)
- Wildcards match exactly one token
- More efficient for natural language processing

## Proposed Structure: Start → Preamble Command Postamble

The NFA infrastructure is designed to support the regular grammar pattern discussed in your transcription:

```
start → preamble command postamble
```

Where:

- `preamble` and `postamble` are optional boilerplate (politeness, greetings)
- `command` is the core action
- Everything is regular (no recursive nesting)

### Example Implementation

```typescript
const grammar: Grammar = {
  rules: [
    {
      parts: [
        // Optional preamble
        {
          type: "rules",
          optional: true,
          rules: [
            { parts: [{ type: "string", value: ["please"] }] },
            { parts: [{ type: "string", value: ["kindly"] }] },
          ],
        },
        // Core command
        {
          type: "wildcard",
          variable: "command",
          typeName: "string",
        },
        // Optional postamble
        {
          type: "rules",
          optional: true,
          rules: [
            { parts: [{ type: "string", value: ["thanks"] }] },
            { parts: [{ type: "string", value: ["thank you"] }] },
          ],
        },
      ],
    },
  ],
};
```

This matches:

- "schedule meeting" (just command)
- "please schedule meeting" (preamble + command)
- "schedule meeting thanks" (command + postamble)
- "please schedule meeting thank you" (preamble + command + postamble)

## Future Work

### DFA Compilation

The next step is to implement NFA → DFA conversion:

```typescript
// Future API
import { compileToDFA } from "./dfaCompiler.js";

const nfa = compileGrammarToNFA(grammar);
const dfa = compileToDFA(nfa); // Subset construction algorithm

// DFA matching is faster (deterministic, no backtracking)
const result = matchDFA(dfa, tokens);
```

### Grammar Merging

For combining generated rules with existing grammars:

```typescript
// Future API
import { mergeGrammars } from "./grammarMerger.js";

const baseGrammar = loadGrammar("base.agr");
const generatedRules = generateFromExample(example);

const merged = mergeGrammars(baseGrammar, generatedRules);
const nfa = compileGrammarToNFA(merged);
```

## Testing

Run the test suite:

```bash
cd packages/actionGrammar
npm test -- nfa.spec
```

Tests cover:

- NFA builder operations
- Grammar compilation
- Alternatives, sequences, optionals
- Wildcard and number matching
- NFA combination
- Debug printing

## Implementation Notes

### Why Token-Based?

1. **Natural language focus**: Tokens (words) are the semantic units
2. **No character-level complexity**: No need for character classes, Unicode handling
3. **Efficient matching**: Fewer transitions than character-based
4. **Easy integration**: Works directly with tokenized input

### Why Separate from Existing Grammar System?

The existing `grammarMatcher.ts` is optimized for the current use case. This new NFA infrastructure provides:

1. **Theoretical foundation**: Standard NFA/DFA algorithms
2. **Debugging tools**: Inspect and trace automaton execution
3. **Extensibility**: Easy to add DFA compilation, optimization
4. **Grammar composition**: Formal operations for combining grammars

Both systems can coexist:

- Use NFA infrastructure for grammar development and debugging
- Compile to existing matcher for production performance
- Or replace existing matcher with DFA compiler (future)
