# Grammar Module System

This document describes the module system for grammar symbols, which provides:

1. **Namespace support** for symbols (e.g., `Global.Ordinal`, `Calendar.CalendarDate`)
2. **Static TypeScript linking** via imports/exports
3. **Dual client support**: Cache clients (matching only) and Agent clients (matching + conversion)

## Architecture

### Key Components

1. **Symbol Matchers** - Test if a token matches a symbol type (used by cache)
2. **Symbol Converters** - Both match and convert tokens to typed values (used by agents)
3. **Symbol Registry** - Internal mapping from symbol names to matchers/converters
4. **TypeScript Modules** - Grammar symbols defined as TypeScript modules with exports

### Static Linking

Grammar symbols are **statically linked** using standard TypeScript imports:

- No dynamic registry service
- No runtime grammar loading
- All symbol resolution happens at compile time
- Converters linked via normal TypeScript module system

## Built-in Symbols

### Global Module

#### `Global.Ordinal` (or just `Ordinal` within Global module)

Converts ordinal words to numbers.

```typescript
import { Ordinal, convertOrdinalValue } from "./symbols/ordinal.js";

// Matcher (for cache)
Ordinal.match("first"); // true
Ordinal.match("tenth"); // true

// Converter (for agents)
Ordinal.convert("first"); // 1
Ordinal.convert("twenty-third"); // 23

// Helper function
convertOrdinalValue("first"); // 1
```

**Supported values:**

- `first` → 1
- `second` → 2
- `third` → 3
- ... through `thirtieth` → 30

#### `Global.Cardinal` (or just `Cardinal` within Global module)

Converts cardinal words and numeric strings to numbers.

```typescript
import { Cardinal, convertCardinalValue } from "./symbols/cardinal.js";

// Matches both word numbers and numeric strings
Cardinal.match("five"); // true
Cardinal.match("42"); // true

Cardinal.convert("five"); // 5
Cardinal.convert("42"); // 42

convertCardinalValue("thirty"); // 30
```

**Supported values:**

- Word numbers: `one`, `two`, `three`, ... through `thirty`
- Numeric strings: `"1"`, `"42"`, `"999"`, etc.

### Calendar Module

#### `Calendar.CalendarDate` (or just `CalendarDate` within Calendar module)

Converts date-like strings to Date objects.

```typescript
import {
  CalendarDate,
  convertCalendarDateValue,
} from "./symbols/calendarDate.js";

// Matcher
CalendarDate.match("today"); // true
CalendarDate.match("tomorrow"); // true
CalendarDate.match("2026-01-23"); // true
CalendarDate.match("monday"); // true

// Converter
CalendarDate.convert("today"); // Date object for today
CalendarDate.convert("tomorrow"); // Date object for tomorrow
CalendarDate.convert("2026-01-23"); // Date object for Jan 23, 2026

convertCalendarDateValue("today"); // Date object
```

**Supported formats:**

- Relative: `today`, `tomorrow`, `yesterday`
- ISO dates: `YYYY-MM-DD` (e.g., `2026-01-23`)
- Weekdays: `monday`, `tuesday`, etc. (next occurrence)

## Usage

### For Cache Clients (Matching Only)

Cache clients only need to know if a user request matches a grammar pattern. They use matchers but don't need conversions.

```typescript
import { registerBuiltInSymbols } from "./symbols/index.js";
import { compileGrammarToNFA } from "./nfaCompiler.js";
import { matchNFA } from "./nfaInterpreter.js";

// Initialize symbol registry
registerBuiltInSymbols();

// Define grammar using symbol types
const grammar: Grammar = {
  rules: [
    {
      parts: [
        { type: "string", value: ["play"] },
        { type: "wildcard", variable: "n", typeName: "Ordinal" },
      ],
    },
  ],
};

// Compile to NFA
const nfa = compileGrammarToNFA(grammar);

// Match user input
const result = matchNFA(nfa, ["play", "first"]);

if (result.matched) {
  console.log("Request matches cached pattern!");
  // Cache hit - no need to use captured values
}
```

### For Agent Clients (Matching + Conversion)

Agent clients need the actual converted values to execute actions. They use converters to get typed values.

```typescript
import { registerBuiltInSymbols } from "./symbols/index.js";
import { convertOrdinalValue } from "./symbols/ordinal.js";
import { convertCalendarDateValue } from "./symbols/calendarDate.js";
import { compileGrammarToNFA } from "./nfaCompiler.js";
import { matchNFA } from "./nfaInterpreter.js";

// Initialize symbol registry
registerBuiltInSymbols();

// Define grammar
const grammar: Grammar = {
  rules: [
    {
      parts: [
        { type: "string", value: ["schedule"] },
        { type: "wildcard", variable: "event", typeName: "string" },
        { type: "string", value: ["on"] },
        { type: "wildcard", variable: "date", typeName: "CalendarDate" },
      ],
    },
  ],
};

// Compile and match
const nfa = compileGrammarToNFA(grammar);
const result = matchNFA(nfa, ["schedule", "meeting", "on", "tomorrow"]);

if (result.matched) {
  // Extract typed values
  const eventName = result.captures.get("event") as string;
  const date = result.captures.get("date") as Date;

  // Use converted values for action execution
  scheduleEvent(eventName, date);
}

// Or convert parameters received as strings
function handleScheduleAction(params: { date: string }) {
  // Convert the CalendarDate string to a Date object
  const dateObj = convertCalendarDateValue(params.date);
  if (dateObj) {
    // Use the Date object
    calendar.addEvent(dateObj);
  }
}
```

## Creating Custom Symbols

### 1. Create a TypeScript Module

Create a new file in `src/symbols/`:

```typescript
// src/symbols/mySymbol.ts
import { SymbolConverter, createConverter } from "../symbolModule.js";

function matchMySymbol(token: string): boolean {
  // Implement matching logic
  return token.toLowerCase() === "valid";
}

function convertMySymbol(token: string): MyType | undefined {
  // Implement conversion logic
  if (token.toLowerCase() === "valid") {
    return { type: "MyType", value: token };
  }
  return undefined;
}

export const MySymbol: SymbolConverter<MyType> = createConverter(
  matchMySymbol,
  convertMySymbol,
);

export function convertMySymbolValue(token: string): MyType | undefined {
  return MySymbol.convert(token);
}
```

### 2. Register the Symbol

Add to `src/symbols/index.ts`:

```typescript
import { MySymbol } from "./mySymbol.js";

export function registerBuiltInSymbols(): void {
  // ... existing registrations ...

  // Register with module namespace
  globalSymbolRegistry.registerConverter("MyModule.MySymbol", MySymbol);

  // Register unqualified for use within MyModule
  globalSymbolRegistry.registerConverter("MySymbol", MySymbol);
}

export { MySymbol, convertMySymbolValue } from "./mySymbol.js";
```

### 3. Use in Grammar

```typescript
const grammar: Grammar = {
  rules: [
    {
      parts: [{ type: "wildcard", variable: "x", typeName: "MySymbol" }],
    },
  ],
  moduleName: "MyModule", // Optional module name
};
```

## Module Declarations in Grammar Files

Grammar files can declare their module name using comments:

```
// module Global

@ <Ordinal> = first -> 1 | second -> 2 | ...
```

Multiple files can contribute to the same module:

```
// File 1: globalOrdinals.agr
// module Global
@ <Ordinal> = first -> 1 | ...

// File 2: globalCardinals.agr
// module Global
@ <Cardinal> = one -> 1 | ...
```

Within a module, symbols don't need qualification:

```
// Within Global module
@ <MyRule> = play (the)? $(n:Ordinal) track

// From another module, would need:
@ <MyRule> = play (the)? $(n:Global.Ordinal) track
```

## Symbol Type Resolution

When the NFA interpreter encounters a wildcard with a type name:

1. **Built-in types**: `number`, `string` are handled specially
2. **Registered symbols**: Lookup in `globalSymbolRegistry`
   - Use `matcher.match()` to test if token matches
   - Use `converter.convert()` to get typed value (if available)
3. **Unknown types**: Treated as string wildcards (match any token)

## Benefits of This Design

### For Cache Clients

- Fast matching without conversion overhead
- Only need to know if pattern matches
- Can skip converter registration if only matching

### For Agent Clients

- Type-safe conversion to proper TypeScript types
- Helper functions provide clean API
- Converters linked via standard TypeScript imports
- No runtime registry lookup needed in agent code

### For Grammar Authors

- Module namespace prevents name collisions
- Symbols can be shared across grammars
- Standard TypeScript tooling (imports, type checking)
- No special build or registration system needed

### For System Architecture

- Static linking via TypeScript
- No dynamic loading or runtime registry service
- Tree-shaking works naturally
- Easy to test and debug

## Testing

Run symbol module tests:

```bash
cd packages/actionGrammar
npm test -- symbolModule.spec
```

Tests cover:

- Symbol registration
- Matcher functionality
- Converter functionality
- NFA integration
- Cache client usage
- Agent client usage

## Future Extensions

### DFA Compilation

When DFA compilation is implemented, the same symbol system will work:

```typescript
const dfa = compileToDFA(nfa);
const result = matchDFA(dfa, tokens);
// Converters still called via globalSymbolRegistry
```

### Grammar Merging

Combine grammars from different modules:

```typescript
const globalGrammar = loadGrammar("globalModule.agr");
const calendarGrammar = loadGrammar("calendarModule.agr");
const merged = mergeGrammars(globalGrammar, calendarGrammar);
```

Symbol resolution works across merged grammars using the registry.

## Example: Complete Flow

```typescript
// 1. Initialize symbols (once at startup)
import { registerBuiltInSymbols } from "./symbols/index.js";
registerBuiltInSymbols();

// 2. Load and compile grammar
const grammar: Grammar = {
  rules: [
    {
      parts: [
        { type: "string", value: ["play"] },
        { type: "string", value: ["track"] },
        { type: "wildcard", variable: "n", typeName: "Cardinal" },
      ],
    },
  ],
};
const nfa = compileGrammarToNFA(grammar, "player");

// 3. Cache client - just match
const cacheResult = matchNFA(nfa, ["play", "track", "5"]);
if (cacheResult.matched) {
  console.log("Cache hit!");
}

// 4. Agent client - match and convert
const agentResult = matchNFA(nfa, ["play", "track", "five"]);
if (agentResult.matched) {
  const trackNum = agentResult.captures.get("n") as number;
  player.playTrack(trackNum); // trackNum is 5 (number type)
}

// 5. Agent parameter conversion
function playTrackAction(params: { trackNumber: string }) {
  // Parameter comes as string but is actually a Cardinal
  import { convertCardinalValue } from "./symbols/cardinal.js";
  const trackNum = convertCardinalValue(params.trackNumber);
  if (trackNum !== undefined) {
    player.playTrack(trackNum);
  }
}
```
