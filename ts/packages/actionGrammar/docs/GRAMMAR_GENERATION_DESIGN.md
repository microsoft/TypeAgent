# LLM-Based Comprehensive Grammar Generation

## Problem Statement

Users should experience proportional cost when interacting with TypeAgent:

1. **Simple requests** (e.g., "play a song", "add calendar event") → **Instant** (grammar match)
2. **Compound sentences** (e.g., "play this and add that") → **Fast** (grammar match to multipleActionSchema)
3. **Complex workflows** (e.g., "get top 10 streaming songs and make a playlist") → **Acceptable delay** (reasoning model, seconds to minute)
4. **Unusual phrasings** (e.g., "my ear wants to hear shake it off", "swift me") → **Brief delay** (intermediate model translates, then populates cache)

To achieve this, we need comprehensive grammars that cover common ways to express actions in natural language, while allowing dynamic expansion for unusual phrasings.

## Goals

1. **Coverage**: Generate grammars that match 90%+ of common user requests without LLM
2. **Multi-language**: Support grammar generation in any natural language
3. **Compound requests**: Handle multi-action sentences with conjunctions
4. **Dynamic learning**: Allow cache population for unusual phrasings that get translated
5. **Maintainability**: Automated generation reduces manual grammar authoring

## Architecture

### Overview

```
┌─────────────────────────────────────────────────────────────┐
│                  Grammar Generation Pipeline                 │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐      ┌──────────────┐                     │
│  │   Schema     │─────>│    Seed      │                     │
│  │   Analyzer   │      │   Grammar    │                     │
│  └──────────────┘      └──────┬───────┘                     │
│                                │                             │
│                                v                             │
│                       ┌────────────────┐                     │
│                       │      LLM       │                     │
│                       │    Expander    │                     │
│                       └────────┬───────┘                     │
│                                │                             │
│                    ┌───────────┴────────────┐               │
│                    v                        v               │
│           ┌────────────────┐       ┌──────────────┐         │
│           │   Base Action  │       │  Compound    │         │
│           │    Patterns    │       │  Patterns    │         │
│           └────────┬───────┘       └──────┬───────┘         │
│                    │                      │                 │
│                    └──────────┬───────────┘                 │
│                               v                             │
│                    ┌──────────────────┐                     │
│                    │   Validation &   │                     │
│                    │ Deduplication    │                     │
│                    └──────────┬───────┘                     │
│                               v                             │
│                    ┌──────────────────┐                     │
│                    │  Compiled NFA/   │                     │
│                    │      DFA         │                     │
│                    └──────────────────┘                     │
│                                                               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  Runtime Dynamic Learning                    │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  User says unusual phrasing                                  │
│  ────────────────────────>                                   │
│                           LLM translates                     │
│                           Returns: (action, pattern)         │
│                           ────────────────────>              │
│                                                Grammar Store │
│                                                adds pattern  │
│                                                              │
│  Next time: instant match via grammar                        │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Phase 1: Schema Analysis

### Input

- Action schema (TypeScript, PAS, or compiled .pas.json)
- Action manifest with action names and descriptions

### Process

1. Extract action names (e.g., `playTrack`, `addCalendarEvent`)
2. Extract parameter names and types (e.g., `trackName: string`, `artist: string`)
3. Identify checked wildcards (entity types from `paramSpec`)
4. Extract action descriptions and natural language hints

### Output

```typescript
interface ActionMetadata {
  actionName: string;
  description?: string;
  parameters: {
    name: string;
    type: string; // TypeScript type
    entityType?: string; // Entity type for checked wildcards
    optional: boolean;
    description?: string;
  }[];
}
```

## Phase 2: Seed Grammar Generation

### Process

Generate minimal seed patterns from action metadata:

**Template-based generation:**

```
<actionVerb> <param1> [<param2>] [...]
```

**Example:**

- Action: `playTrack(trackName: string, artist?: string)`
- Seeds:
  - `play $(trackName:string)`
  - `play $(trackName:string) by $(artist:string)`

### Output

Minimal .ag grammar file with basic patterns.

## Phase 3: LLM-Based Pattern Expansion

### 3.1 Single-Language Expansion

**Goal:** Generate 50-200 natural variations of each seed pattern in a target language.

**LLM Prompt Template:**

```
You are a natural language grammar generator for a voice assistant.

Given the following action:
- Action name: {actionName}
- Description: {description}
- Parameters: {parameters}
- Example seed patterns: {seedPatterns}

Generate 100 natural ways a user might express this request in {language}.

Requirements:
1. Cover different syntactic structures (imperative, question, statement)
2. Include common variations (contractions, colloquialisms)
3. Maintain all required parameters as wildcards: $(paramName:typeName)
4. Use natural word order for {language}
5. Include polite forms ("please", "could you")
6. Include casual forms ("wanna", "gonna")

Output format:
One pattern per line using the grammar syntax:
<pattern>

Example output for "playTrack":
play $(trackName:string)
play $(trackName:string) by $(artist:string)
can you play $(trackName:string)
I want to hear $(trackName:string)
put on $(trackName:string)
start playing $(trackName:string)
play me $(trackName:string)
...
```

**Implementation:**

```typescript
interface GrammarExpander {
  expandAction(
    metadata: ActionMetadata,
    language: string,
    targetCount: number,
  ): Promise<string[]>; // Returns grammar patterns
}

class LLMGrammarExpander implements GrammarExpander {
  constructor(private llmClient: LLMClient) {}

  async expandAction(
    metadata: ActionMetadata,
    language: string,
    targetCount: number,
  ): Promise<string[]> {
    const prompt = this.buildExpansionPrompt(metadata, language, targetCount);
    const response = await this.llmClient.complete(prompt);
    return this.parsePatterns(response);
  }
}
```

### 3.2 Multi-Language Support

**Languages to support:**

- English (en-US, en-GB, en-AU, etc.)
- Spanish (es-ES, es-MX, es-AR, etc.)
- French (fr-FR, fr-CA)
- German (de-DE)
- Italian (it-IT)
- Portuguese (pt-BR, pt-PT)
- Japanese (ja-JP)
- Chinese (zh-CN, zh-TW)
- Korean (ko-KR)
- Hindi (hi-IN)

**Language-specific considerations:**

- Word order (SOV vs SVO)
- Gender agreement
- Formal/informal registers
- Common contractions and abbreviations
- Cultural conventions

### 3.3 Validation Pipeline

For each generated pattern:

1. **Parse validation:** Ensure pattern compiles to valid grammar
2. **Parameter validation:** Verify all required parameters are present
3. **Duplicate detection:** Remove patterns that produce identical NFA structure
4. **Quality scoring:** Rank patterns by naturalness, common usage

```typescript
interface PatternValidator {
  validate(pattern: string, metadata: ActionMetadata): ValidationResult;
}

interface ValidationResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
  score?: number; // Quality score 0-1
}
```

## Phase 4: Compound Pattern Generation

### 4.1 Multi-Action Compounds

**Goal:** Generate patterns that match multiple actions in sequence/parallel.

**Conjunction patterns:**

- "A and B" (parallel)
- "A then B" (sequence)
- "A and then B" (sequence)
- "A, B, and C" (parallel list)
- "A before B" (sequence)
- "A after B" (sequence)

**Target schema:** `multipleActionSchema` (see [multipleActionSchema.ts](../../dispatcher/dispatcher/src/translation/multipleActionSchema.ts))

**Example patterns:**

```
play $(trackName:string) and add it to $(playlistName:string)
search for $(query:string) then play the first result
create a playlist called $(name:string) and add $(trackName:string) to it
play $(trackName1:string) then $(trackName2:string)
```

**LLM Prompt Template:**

```
Generate compound sentence patterns that combine these actions:
- Action 1: {action1Name} - {action1Description}
- Action 2: {action2Name} - {action2Description}

Generate 50 natural ways to express both actions in a single sentence in {language}.

Requirements:
1. Use conjunctions (and, then, before, after, etc.)
2. Include anaphora resolution hints (e.g., "it", "that", "the result")
3. Maintain all required parameters as wildcards
4. Output format: pattern -> {action1; action2}

Example:
play $(trackName:string) and add it to $(playlistName:string) -> {playTrack; addToPlaylist}
```

### 4.2 Anaphora Resolution

For compound patterns, track pronoun references:

```
play $(trackName:string) and add it to $(playlistName:string)
                              ^^^^
                              refers to trackName
```

**Implementation strategy:**

- Mark anaphora in grammar: `$(it:reference=trackName)`
- LLM identifies reference targets in prompt
- Grammar compiler resolves references to parameters

## Phase 5: Grammar Compilation and Optimization

### 5.1 Deduplication

After generating thousands of patterns, deduplicate by NFA structure:

```typescript
interface GrammarOptimizer {
  deduplicateByStructure(patterns: string[]): string[];
  prioritizeByUsage(patterns: string[], usageStats: UsageStats): string[];
  pruneRarePatterns(patterns: string[], threshold: number): string[];
}
```

**Deduplication algorithm:**

1. Compile each pattern to NFA
2. Compute NFA structural hash (states + transitions)
3. Keep only one pattern per unique NFA structure
4. Prefer shorter/simpler patterns when equivalent

### 5.2 Priority Assignment

Assign priorities based on:

1. **Fixed string parts** (more = higher priority)
2. **Checked wildcards** (more = higher priority)
3. **Unchecked wildcards** (fewer = higher priority)
4. **Usage frequency** (from analytics)

### 5.3 DFA Pre-compilation

Pre-compile frequently used grammars to DFA:

- Per-agent DFAs for fast matching
- Cache compiled DFAs to disk
- Async worker compilation for large grammars

## Phase 6: Dynamic Learning

### 6.1 Runtime Cache Population

When LLM translates an unusual request:

```typescript
interface TranslationResult {
  action: AppAction;
  pattern?: string; // NEW: The pattern that matched (if applicable)
  sourceText: string; // Original user text
}

// When LLM translates a new phrasing:
async function translateUnusualRequest(
  text: string,
  llm: LLMClient,
): Promise<TranslationResult> {
  const result = await llm.translate(text);

  // Add pattern to grammar store for future instant matching
  if (result.pattern) {
    await grammarStore.addDynamicRule({
      pattern: result.pattern,
      action: result.action,
      source: "llm-translation",
      usageCount: 1,
      firstSeen: new Date(),
    });
  }

  return result;
}
```

### 6.2 Pattern Promotion

Periodically promote frequently-used dynamic patterns to base grammar:

```typescript
interface DynamicPatternStats {
  pattern: string;
  usageCount: number;
  lastUsed: Date;
  userCount: number; // How many different users
}

async function promotePatterns(threshold: number = 100) {
  const popularPatterns = await grammarStore.getPopularPatterns(threshold);

  for (const pattern of popularPatterns) {
    // Add to base grammar
    await baseGrammar.addRule(pattern);

    // Recompile DFA
    await dfaCompilationManager.recompile(baseGrammar);

    // Remove from dynamic store
    await grammarStore.removeDynamicRule(pattern.id);
  }
}
```

## Implementation Plan

### Stage 1: Schema Analysis and Seed Generation

**Components to build:**

- `SchemaAnalyzer`: Parse TypeScript/PAS schemas
- `SeedGrammarBuilder`: Generate minimal patterns
- `ActionMetadataExtractor`: Extract action metadata

**Deliverable:** Seed grammars for all existing agents

### Stage 2: Single-Action Expansion

**Components to build:**

- `LLMGrammarExpander`: LLM-based pattern generation
- `PatternValidator`: Validation pipeline
- `GrammarOptimizer`: Deduplication and prioritization

**Deliverable:** Comprehensive base grammars for single actions (English)

### Stage 3: Multi-Language Support

**Components to build:**

- Language-specific prompt templates
- Translation validation
- Multi-language grammar compilation

**Deliverable:** Grammars in top 5 languages

### Stage 4: Compound Pattern Generation

**Components to build:**

- `CompoundPatternGenerator`: Multi-action patterns
- Anaphora resolution system
- Integration with multipleActionSchema

**Deliverable:** Comprehensive compound grammars

### Stage 5: Dynamic Learning

**Components to build:**

- Runtime pattern capture from LLM translations
- Dynamic rule storage in GrammarStore
- Pattern promotion pipeline

**Deliverable:** Self-improving grammar system

### Stage 6: Analytics and Optimization

**Components to build:**

- Usage analytics (grammar match vs LLM fallback rates)
- Coverage analysis
- Performance monitoring

**Deliverable:** Data-driven grammar optimization

## API Design

### Grammar Generator API

```typescript
// Main entry point
class GrammarGenerator {
  constructor(
    private schemaAnalyzer: SchemaAnalyzer,
    private seedBuilder: SeedGrammarBuilder,
    private expander: GrammarExpander,
    private validator: PatternValidator,
    private optimizer: GrammarOptimizer,
  ) {}

  /**
   * Generate comprehensive grammar for an agent
   */
  async generateAgentGrammar(
    schemaPath: string,
    options: GenerationOptions,
  ): Promise<GeneratedGrammar> {
    // 1. Analyze schema
    const metadata = await this.schemaAnalyzer.analyze(schemaPath);

    // 2. Generate seeds
    const seeds = await this.seedBuilder.generateSeeds(metadata);

    // 3. Expand with LLM
    const expanded: string[] = [];
    for (const action of metadata.actions) {
      const patterns = await this.expander.expandAction(
        action,
        options.language,
        options.patternsPerAction,
      );
      expanded.push(...patterns);
    }

    // 4. Validate
    const validated = expanded.filter(
      (pattern) => this.validator.validate(pattern, metadata).valid,
    );

    // 5. Optimize
    const optimized = this.optimizer.deduplicateByStructure(validated);
    const prioritized = this.optimizer.prioritizeByUsage(
      optimized,
      options.usageStats,
    );

    // 6. Compile
    const grammar = grammarFromPatterns(prioritized);
    const nfa = compileGrammarToNFA(grammar);
    const dfa = await compileNFAToDFA(nfa, metadata.agentName);

    return {
      grammar,
      nfa,
      dfa,
      stats: {
        seedCount: seeds.length,
        expandedCount: expanded.length,
        validatedCount: validated.length,
        finalCount: prioritized.length,
      },
    };
  }

  /**
   * Generate compound patterns across multiple actions
   */
  async generateCompoundPatterns(
    actions: ActionMetadata[],
    language: string,
  ): Promise<string[]> {
    // Generate all pairs/triples of actions
    const compounds: string[] = [];

    for (const action1 of actions) {
      for (const action2 of actions) {
        if (action1 === action2) continue;

        const patterns = await this.expander.expandCompound(
          action1,
          action2,
          language,
        );
        compounds.push(...patterns);
      }
    }

    return this.optimizer.deduplicateByStructure(compounds);
  }
}

interface GenerationOptions {
  language: string;
  patternsPerAction: number;
  includeCompounds: boolean;
  usageStats?: UsageStats;
}

interface GeneratedGrammar {
  grammar: Grammar;
  nfa: NFA;
  dfa: DFA;
  stats: {
    seedCount: number;
    expandedCount: number;
    validatedCount: number;
    finalCount: number;
  };
}
```

### Runtime Integration

```typescript
// In dispatcher or cache layer
class SmartGrammarMatcher {
  constructor(
    private dfaMatcher: DFAMatcher,
    private nfaMatcher: NFAMatcher,
    private llmFallback: LLMTranslator,
    private grammarStore: GrammarStore,
  ) {}

  async match(text: string, agentName: string): Promise<MatchResult> {
    const tokens = tokenize(text);

    // 1. Try DFA (fastest)
    const dfa = await this.grammarStore.getDFA(agentName);
    if (dfa) {
      const dfaResult = matchDFA(dfa, tokens);
      if (dfaResult.matched) {
        return {
          source: "dfa",
          action: this.buildAction(dfaResult),
          latencyMs: dfaResult.executionTimeMs,
        };
      }
    }

    // 2. Try NFA (fast)
    const nfa = await this.grammarStore.getNFA(agentName);
    if (nfa) {
      const nfaResult = matchNFA(nfa, tokens);
      if (nfaResult.matched) {
        return {
          source: "nfa",
          action: this.buildAction(nfaResult),
          latencyMs: nfaResult.executionTimeMs,
        };
      }
    }

    // 3. Try dynamic rules (cached unusual phrasings)
    const dynamicRule = await this.grammarStore.matchDynamicRule(tokens);
    if (dynamicRule) {
      await this.grammarStore.incrementUsageCount(dynamicRule.id);
      return {
        source: "dynamic",
        action: dynamicRule.action,
        latencyMs: dynamicRule.executionTimeMs,
      };
    }

    // 4. Fallback to LLM translation
    const llmResult = await this.llmFallback.translate(text);

    // 5. Capture pattern for future instant matching
    if (llmResult.pattern) {
      await this.grammarStore.addDynamicRule({
        pattern: llmResult.pattern,
        action: llmResult.action,
        source: "llm-translation",
        usageCount: 1,
        firstSeen: new Date(),
      });
    }

    return {
      source: "llm",
      action: llmResult.action,
      latencyMs: llmResult.executionTimeMs,
    };
  }
}
```

## Evaluation Metrics

### Coverage Metrics

- **Grammar match rate:** % of requests matched by grammar (target: 90%+)
- **DFA match rate:** % of requests matched by DFA (target: 70%+)
- **LLM fallback rate:** % of requests requiring LLM (target: <10%)

### Performance Metrics

- **DFA match latency:** Time to match via DFA (target: <1ms)
- **NFA match latency:** Time to match via NFA (target: <10ms)
- **LLM latency:** Time to translate via LLM (target: <2s)

### Quality Metrics

- **Pattern naturalness:** Human evaluation of generated patterns
- **Parameter extraction accuracy:** Correct parameter binding rate
- **False positive rate:** Incorrect matches
- **False negative rate:** Missed valid requests

### Learning Metrics

- **Dynamic rule usage:** How often dynamic rules match
- **Promotion rate:** Dynamic rules promoted to base grammar
- **Coverage improvement:** Grammar match rate over time

## Example: Player Agent

### Input Schema

```typescript
interface PlayerActions {
  playTrack(trackName: string, artist?: string): ActionResult;
  pause(): ActionResult;
  resume(): ActionResult;
  skipTrack(): ActionResult;
  addToPlaylist(trackName: string, playlistName: string): ActionResult;
}
```

### Generated Base Patterns (English)

```
// Play action (100+ patterns)
play $(trackName:string)
play $(trackName:string) by $(artist:string)
can you play $(trackName:string)
I want to hear $(trackName:string)
put on $(trackName:string)
start playing $(trackName:string)
play me $(trackName:string)
let's listen to $(trackName:string)
could you put on $(trackName:string)
I'd like to hear $(trackName:string)
...

// Pause action (50+ patterns)
pause
pause the music
can you pause
stop the music
hold on
wait
pause playback
...

// Compound patterns
play $(trackName:string) and add it to $(playlistName:string)
play $(trackName:string) then add to $(playlistName:string)
search for $(trackName:string) and play it
play $(trackName:string) by $(artist:string) and add to my $(playlistName:string) playlist
...
```

### Generated Patterns (Spanish)

```
reproduce $(trackName:string)
toca $(trackName:string)
pon $(trackName:string)
quiero escuchar $(trackName:string)
reproduce $(trackName:string) de $(artist:string)
ponme $(trackName:string)
...
```

## Open Questions

1. **LLM Model Selection:** Which model for pattern generation? (GPT-4, Claude, Llama)
2. **Generation Frequency:** How often to regenerate grammars? On schema change only, or periodic?
3. **Quality Control:** Human review of generated patterns? Automated testing only?
4. **Storage:** Store generated grammars in repo, or generate on-demand?
5. **Versioning:** How to version generated grammars? Per-agent, per-language, per-generation?
6. **Compound Complexity:** How many actions to combine? 2-way, 3-way, N-way?
7. **Anaphora Resolution:** Full NLP anaphora resolution, or simple heuristics?
8. **Privacy:** Can we use real user queries for grammar improvement? Anonymization required?

## Next Steps

1. Build SchemaAnalyzer and SeedGrammarBuilder
2. Implement LLMGrammarExpander with prompt templates
3. Create PatternValidator with grammar compilation checks
4. Test with Player agent as pilot
5. Measure coverage on real user queries
6. Iterate on prompt engineering based on results
7. Expand to multi-language support
8. Implement compound pattern generation
9. Build dynamic learning pipeline
10. Deploy and monitor coverage metrics
