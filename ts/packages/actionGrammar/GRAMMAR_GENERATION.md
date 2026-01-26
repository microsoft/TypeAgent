# Grammar Generation System

This document describes the grammar generation system moved from `agentSdkWrapper` to `actionGrammar`.

## Overview

The grammar generation system uses Claude to analyze request/action pairs and automatically generate Action Grammar rules for caching. This enables the system to learn from user interactions and build up a comprehensive grammar over time.

## Architecture

### Modules

- **grammarGenerator.ts**: Core Claude-powered grammar analyzer that examines request/action pairs and generates grammar patterns
- **schemaToGrammarGenerator.ts**: Batch grammar generation from complete agent schemas
- **schemaReader.ts**: Loads and parses `.pas.json` schema files to extract parameter validation information
- **testTypes.ts**: Type definitions for grammar test cases

### CLI Tools

Two command-line tools are provided:

1. **generate-grammar**: Generate complete grammar files from schemas
2. **test-grammar**: Test grammar generation for individual request/action pairs

## Cache Population Interface

The primary integration point for agentServer is the `populateCache` function:

```typescript
import { populateCache, CachePopulationRequest } from "action-grammar/generation";

const result = await populateCache({
    request: "play Bohemian Rhapsody by Queen",
    schemaName: "player",
    action: {
        actionName: "playTrack",
        parameters: {
            trackName: "Bohemian Rhapsody",
            artistName: "Queen"
        }
    },
    schemaPath: "./packages/agents/player/dist/playerSchema.pas.json"
});

if (result.success) {
    console.log("Generated rule:", result.generatedRule);
    // Add rule to cache
} else {
    console.log("Rejected:", result.rejectionReason);
}
```

### Integration Flow

1. **User makes request** → Claude generates action
2. **Claude prompts user** → "Should I cache this pattern?"
3. **User confirms** → MCP server sends confirmation
4. **MCP server calls** → agentServer cache population endpoint
5. **agentServer calls** → `populateCache(request)`
6. **Grammar generated** → Rule added to agent's dynamic grammar

### Request Structure

```typescript
interface CachePopulationRequest {
    // The natural language request from the user
    request: string;
    // The schema name (agent name) this action belongs to
    schemaName: string;
    // The action that was confirmed by the user
    action: {
        actionName: string;
        parameters: Record<string, any>;
    };
    // Path to the .pas.json schema file for validation info
    schemaPath: string;
}
```

### Response Structure

```typescript
interface CachePopulationResult {
    // Whether the grammar rule was successfully generated and added
    success: boolean;
    // The generated grammar rule text (if successful)
    generatedRule?: string;
    // Reason for rejection (if not successful)
    rejectionReason?: string;
    // The grammar analysis performed
    analysis?: GrammarAnalysis;
    // Warning messages
    warnings?: string[];
}
```

## Grammar Generation Rules

The system follows strict rules to ensure generated grammars are unambiguous:

### Acceptance Criteria

✅ **ACCEPT** patterns with:
- Clear boundaries between wildcards (fixed words, entity types, or validation)
- Entity types that provide validation (e.g., `$(device:MusicDevice)`)
- Checked wildcards with paramSpec validation
- First-person pronouns (I, me, my, we, us, our)

### Rejection Criteria

❌ **REJECT** patterns with:
- **Adjacent unqualified wildcards**: Two plain string wildcards next to each other
  - Example: `$(description:EventDescription) $(participant:ParticipantName)` - ambiguous boundary
- **Third-person referential pronouns**: it, that, this, them, those, these
  - Example: "add it to playlist" - requires conversation history
- **Query parameters**: Arbitrary text search parameters
  - Example: "search for $(query:string)" - too open-ended
- **Missing context**: Dependencies on conversation history
  - Example: "play that again" - requires knowing what "that" refers to

## Command Line Tools

### generate-grammar

Generate a complete grammar file from an agent schema:

```bash
# Basic usage
generate-grammar packages/agents/player/dist/playerSchema.pas.json

# Extend existing grammar
generate-grammar -i player.agr packages/agents/player/dist/playerSchema.pas.json

# With custom output and more examples
generate-grammar -o player.agr -e 5 packages/agents/player/dist/playerSchema.pas.json
```

Options:
- `-s, --schema <path>`: Path to .pas.json schema file
- `-o, --output <path>`: Output path for .agr file
- `-e, --examples <number>`: Number of examples per action (default: 3)
- `-m, --model <model>`: Claude model to use
- `-i, --input <path>`: Existing grammar to extend
- `--improve <instructions>`: Improvement instructions

### test-grammar

Test grammar generation for a single request/action pair:

```bash
# Test a music player request
test-grammar -s packages/agents/player/dist/playerSchema.pas.json \
  -r "play Bohemian Rhapsody by Queen" \
  -a playTrack \
  -p '{"trackName":"Bohemian Rhapsody","artistName":"Queen"}'

# Verbose output with analysis
test-grammar -v -s packages/agents/calendar/dist/calendarSchema.pas.json \
  -r "schedule meeting tomorrow at 2pm" \
  -a scheduleEvent \
  -p '{"eventDescription":"meeting","date":"tomorrow","time":"2pm"}'
```

Options:
- `-s, --schema <path>`: Path to .pas.json schema file (required)
- `-r, --request <text>`: Natural language request (required)
- `-a, --action <name>`: Action name (required)
- `-p, --parameters <json>`: Action parameters as JSON (default: {})
- `-m, --model <model>`: Claude model to use
- `-v, --verbose`: Show detailed analysis

## Testing

Run the grammar generation tests:

```bash
cd packages/actionGrammar
npm test
```

Tests include:
- Basic grammar generation for simple patterns
- Rejection of ambiguous patterns
- Cache population API
- Schema information loading

**Note**: Tests requiring Claude API access will be skipped if `ANTHROPIC_API_KEY` is not set.

## Implementation Details

### Grammar Pattern Analysis

The system performs linguistic analysis of each request:

1. **Parse request linguistically**
   - Identify parts of speech
   - Build dependency tree
   - Create S-expression parse

2. **Map parameters**
   - Match request phrases to action parameters
   - Identify required conversions
   - Determine fixed vs. wildcard parts

3. **Generate pattern**
   - Use `$(paramName:type)` for wildcards
   - Use `(phrase)?` for optional parts
   - Include fixed phrases exactly

4. **Validate pattern**
   - Check for adjacent unqualified wildcards
   - Check for referential pronouns
   - Ensure deterministic parsing

### Wildcard Qualification

Wildcards are considered "qualified" if they have:
- **Entity type**: `$(device:MusicDevice)` - validated against entity registry
- **ParamSpec**: `$(index:ordinal)` - validated with paramSpec parser
- **Checked wildcard**: Parameters with `checked_wildcard` paramSpec

Unqualified wildcards are plain strings with no validation: `$(name:string)`

## Future Enhancements

Planned improvements:
- Automatic duplicate detection across existing rules
- Confidence scoring for generated patterns
- Pattern similarity analysis
- Grammar optimization and merging
- Real-time feedback during generation
- Support for multi-turn patterns
