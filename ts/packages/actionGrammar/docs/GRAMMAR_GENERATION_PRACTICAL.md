# Practical Grammar Generation: Scenario-Based Approach

## Scope

- **Languages:** 90% English, 10% French
- **Complexity:** Simple single-action sentences only (no compounds)
- **Goal:** Generate comprehensive replacement grammars for existing agents
- **Method:** Scenario-based generation with prefix/suffix categories

## Current State Analysis

### Existing Grammars

Based on analysis of [playerSchema.agr](../../agents/player/src/agent/playerSchema.agr), [calendarSchema.agr](../../agents/calendar/src/calendarSchema.agr), and [listSchema.agr](../../agents/list/src/listSchema.agr):

**Coverage:** 3-7 patterns per action
**Structure:** Basic variations with optional parts
**Prefix/Suffix:** Ad-hoc, not systematized

**Example: Current player grammar**

```
pause ((the)? music)?
resume ((the)? music)?
play $(trackName:<TrackPhrase>) by $(artist:<ArtistName>)
select $(deviceName:<DeviceName>)
```

**Gap:** Missing many natural variations:

- "could you pause"
- "I'd like to pause"
- "pause this please"
- "would you mind pausing"
- "go ahead and pause"

## Architecture

### 1. Prefix/Suffix Categories

Create reusable prefix/suffix rules that can be combined with any action.

#### Politeness Prefixes

```
<PolitePrefix> =
    (can you)? (please)?
  | could you (please)?
  | would you (please)?
  | (please)? (can you)?
  | (please)? (could you)?
  | (please)? (would you)?
  | would you mind
  | (I'd)? (I would)? like you to
  | (I was)? hoping you (could)? (would)?
  | if you (could)? (would)?;

// French equivalents
<PolitePrefixFr> =
    pouvez-vous
  | pourriez-vous
  | (s'il)? (vous)? plaît
  | (je)? voudrais (que vous)?
  | (je)? souhaiterais (que vous)?;
```

#### Desire/Intent Prefixes

```
<DesirePrefix> =
    I want to
  | I'd like to
  | I would like to
  | I need to
  | I wanna
  | let me
  | let's
  | I'm trying to
  | help me
  | can I
  | could I;

// French
<DesirePrefixFr> =
    je veux
  | je voudrais
  | j'aimerais
  | (je)? (dois)?
  | laisse-moi
  | aide-moi;
```

#### Action Initiators

```
<ActionInitiator> =
    go ahead and
  | please go ahead and
  | just
  | (just)? quickly;
```

#### Politeness Suffixes

```
<PoliteSuffix> =
    please
  | (if you)? (would)? (could)? please
  | (if you)? don't mind
  | (if)? (that's)? okay
  | (if)? (that's)? alright
  | thanks
  | thank you
  | for me;
```

#### Usage Pattern

Actions can then reference these:

```
<Pause> =
    <PolitePrefix>? pause ((the)? music)? <PoliteSuffix>? -> { actionName: "pause" }
  | <DesirePrefix> pause ((the)? music)? <PoliteSuffix>? -> { actionName: "pause" }
  | <ActionInitiator> pause ((the)? music)? -> { actionName: "pause" };
```

### 2. Scenario-Based Generation

**Concept:** Generate variations by simulating realistic user scenarios, not just syntactic variations.

#### Generation Process

```
Scenario → User Goals → Situations → Utterances → Patterns
```

**Example: Music Player Scenarios**

**Scenario 1: "Getting ready for the day"**

- User context: Morning routine, hands busy
- Likely phrases:
  - "play something upbeat"
  - "put on my morning playlist"
  - "start my workout mix"
  - "I need some energy"

**Scenario 2: "Working from home"**

- User context: Needs focus, video calls
  - "play something quiet"
  - "I need concentration music"
  - "pause for my meeting"
  - "switch to headphones"

**Scenario 3: "Cooking dinner"**

- User context: Hands dirty, wants ambiance
  - "turn on some jazz"
  - "play dinner music"
  - "skip this track"
  - "louder please"

**Scenario 4: "Discovering new music"**

- User context: Exploring, searching
  - "play that song from the commercial"
  - "find me something by artist X"
  - "what's this track called"
  - "play similar songs"

#### LLM Prompt for Scenario-Based Generation

```
You are generating natural language patterns for a voice assistant.

Agent: {agentName} ({agentDescription})
Action: {actionName} - {actionDescription}
Parameters: {parameters}

Scenario: {scenarioDescription}
User context: {contextDescription}
User emotional state: {emotionalState}
User physical state: {physicalState}

Generate 20 natural ways a user in this scenario would express this request.

Requirements:
1. Use language natural to the scenario context
2. Consider the user's physical constraints (hands-free, visual attention, etc.)
3. Vary formality based on stress/urgency in the scenario
4. Include domain-specific vocabulary from the scenario
5. Maintain all required parameters as wildcards: $(paramName:typeName)

Output format (one per line):
<pattern> | <context note>

Example output:
play something upbeat | Morning routine, needs energy
put on my morning playlist | Habitual action
start my workout mix | About to exercise
I need some energy | Expressing need state
```

### 3. Scenario Taxonomy

#### Music Player Scenarios

1. **Morning routines** - energetic, quick requests
2. **Work/focus** - longer listening, fewer interruptions
3. **Exercise** - high energy, frequent control
4. **Cooking/cleaning** - hands-free operation
5. **Social gatherings** - playlist management, device switching
6. **Relaxation/sleep** - calm, low interaction
7. **Discovery** - search-heavy, exploratory
8. **Commuting** - mobile context, brief interactions

#### Calendar Scenarios

1. **Meeting scheduling** - formal, detail-oriented
2. **Personal reminders** - casual, quick
3. **Travel planning** - complex, multi-part
4. **Recurring events** - pattern-focused
5. **Time checking** - urgent, brief
6. **Schedule review** - reflective, analytical
7. **Coordination** - collaborative, participant-focused
8. **Rescheduling** - corrective, apologetic

#### List/Todo Scenarios

1. **Shopping prep** - rapid item addition
2. **Task planning** - thoughtful, organized
3. **Brainstorming** - creative, free-form
4. **Delegation** - instructional, clear
5. **Progress tracking** - checking, updating
6. **Quick capture** - minimal interaction
7. **Review/cleanup** - evaluative, decisive

### 4. Implementation Design

#### Phase 1: Prefix/Suffix Library

Create reusable grammar modules:

```typescript
// File: commonPrefixes.agr
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Politeness prefixes for English
<PolitePrefix_EN> =
    (can you)? (please)?
  | could you (please)?
  | would you (please)?
  | (please)? (can you)?
  | (please)? (could you)?
  | (please)? (would you)?
  | would you mind
  | do you mind
  | (I'd)? (I would)? like you to
  | (I was)? hoping you (could)? (would)?
  | if you (could)? (would)?
  | (would)? you be able to;

<DesirePrefix_EN> =
    I want to
  | I'd like to
  | I would like to
  | I need to
  | I wanna
  | I gotta
  | let me
  | let's
  | I'm trying to
  | help me
  | can I
  | could I
  | may I;

<ActionInitiator_EN> =
    go ahead and
  | please go ahead and
  | just
  | (just)? quickly
  | now
  | right now;

<PoliteSuffix_EN> =
    please
  | (if you)? (would)? (could)? please
  | (if you)? don't mind
  | (if)? (that's)? okay
  | (if)? (that's)? alright
  | (if)? possible
  | thanks
  | thank you
  | for me;

// French equivalents
<PolitePrefix_FR> =
    pouvez-vous
  | pourriez-vous
  | (s'il)? (vous)? plaît
  | (je)? voudrais (que vous)?
  | (je)? souhaiterais (que vous)?
  | serait-il possible de;

<DesirePrefix_FR> =
    je veux
  | je voudrais
  | j'aimerais
  | (je)? (dois)?
  | laisse-moi
  | aide-moi
  | (je)? (peux)?;

<ActionInitiator_FR> =
    allez-y
  | juste
  | maintenant
  | tout de suite;

<PoliteSuffix_FR> =
    s'il vous plaît
  | s'il te plaît
  | merci
  | pour moi;
```

#### Phase 2: Scenario Template System

```typescript
interface ScenarioTemplate {
  name: string;
  description: string;
  userContext: {
    situation: string;
    physicalState: string; // "hands-free", "mobile", "stationary"
    emotionalState: string; // "relaxed", "urgent", "focused"
    formality: string; // "casual", "neutral", "formal"
  };
  vocabulary: string[]; // Domain-specific words
  exampleGoals: string[]; // What user wants to accomplish
}

// Example scenario templates
const musicPlayerScenarios: ScenarioTemplate[] = [
  {
    name: "morning-routine",
    description: "User is getting ready in the morning",
    userContext: {
      situation: "morning routine",
      physicalState: "hands-free",
      emotionalState: "groggy to energetic",
      formality: "casual",
    },
    vocabulary: ["upbeat", "energy", "wake up", "morning", "start"],
    exampleGoals: [
      "Start the day with energetic music",
      "Quick music start while multitasking",
      "Familiar playlist for routine",
    ],
  },
  {
    name: "work-focus",
    description: "User needs music for concentration",
    userContext: {
      situation: "working from home or office",
      physicalState: "stationary",
      emotionalState: "focused",
      formality: "neutral",
    },
    vocabulary: ["focus", "concentrate", "quiet", "background", "work"],
    exampleGoals: [
      "Start long-duration focus music",
      "Minimize interruptions",
      "Create work atmosphere",
    ],
  },
  // ... more scenarios
];
```

#### Phase 3: Scenario-Based Pattern Generator

```typescript
interface PatternGenerator {
  generateFromScenario(
    action: ActionMetadata,
    scenario: ScenarioTemplate,
    language: "en" | "fr",
    count: number,
  ): Promise<string[]>;
}

class LLMPatternGenerator implements PatternGenerator {
  async generateFromScenario(
    action: ActionMetadata,
    scenario: ScenarioTemplate,
    language: "en" | "fr",
    count: number,
  ): Promise<string[]> {
    const prompt = `
You are generating natural language patterns for a voice assistant.

ACTION INFORMATION:
- Action: ${action.actionName}
- Description: ${action.description}
- Parameters: ${JSON.stringify(action.parameters)}

SCENARIO:
- Name: ${scenario.name}
- Description: ${scenario.description}
- User situation: ${scenario.userContext.situation}
- Physical state: ${scenario.userContext.physicalState}
- Emotional state: ${scenario.userContext.emotionalState}
- Formality: ${scenario.userContext.formality}
- Domain vocabulary: ${scenario.vocabulary.join(", ")}
- User goals: ${scenario.exampleGoals.join("; ")}

REQUIREMENTS:
1. Generate ${count} natural ${language === "en" ? "English" : "French"} patterns for this action in this scenario
2. Use language appropriate to the scenario context and formality level
3. Consider user's physical/emotional state (e.g., brief if urgent, casual if hands-free)
4. Incorporate domain vocabulary where natural
5. Maintain all required parameters as wildcards: $(paramName:typeName)
6. Vary sentence structure (imperative, question, statement)

OUTPUT FORMAT (one pattern per line):
<pattern>

EXAMPLES FOR "pause" ACTION:
${this.generateExamples(action, scenario, language)}

NOW GENERATE ${count} PATTERNS:
`;

    const response = await this.llmClient.complete(prompt);
    return this.parsePatterns(response);
  }

  private generateExamples(
    action: ActionMetadata,
    scenario: ScenarioTemplate,
    language: "en" | "fr",
  ): string {
    // Generate 3-5 example patterns to guide the LLM
    if (language === "en") {
      if (scenario.userContext.emotionalState.includes("urgent")) {
        return "pause\nquickly pause\npause this right now";
      } else if (scenario.userContext.formality === "casual") {
        return "pause this\nhit pause\ncan you pause";
      } else {
        return "please pause the music\ncould you pause playback\nI need to pause";
      }
    } else {
      return "pause\npouvez-vous mettre en pause\narrête la musique";
    }
  }
}
```

#### Phase 4: Grammar Expansion Pipeline

```typescript
class GrammarExpander {
  constructor(
    private patternGenerator: PatternGenerator,
    private validator: PatternValidator,
    private optimizer: GrammarOptimizer,
  ) {}

  async expandGrammar(
    currentGrammar: string, // Existing .agr file content
    actionMetadata: ActionMetadata[],
    scenarios: ScenarioTemplate[],
    options: ExpansionOptions,
  ): Promise<string> {
    // 1. Parse existing grammar
    const parsed = this.parseGrammar(currentGrammar);

    // 2. Generate patterns for each action across all scenarios
    const allPatterns = new Map<string, string[]>();

    for (const action of actionMetadata) {
      const patterns: string[] = [];

      // Generate from each scenario
      for (const scenario of scenarios) {
        const scenarioPatterns =
          await this.patternGenerator.generateFromScenario(
            action,
            scenario,
            "en",
            options.patternsPerScenario,
          );
        patterns.push(...scenarioPatterns);

        // French patterns (10% of English)
        if (options.includeFrench) {
          const frenchPatterns =
            await this.patternGenerator.generateFromScenario(
              action,
              scenario,
              "fr",
              Math.floor(options.patternsPerScenario * 0.1),
            );
          patterns.push(...frenchPatterns);
        }
      }

      // 3. Validate patterns
      const validated = patterns.filter(
        (p) => this.validator.validate(p, action).valid,
      );

      // 4. Deduplicate by NFA structure
      const deduplicated = this.optimizer.deduplicateByStructure(validated);

      allPatterns.set(action.actionName, deduplicated);
    }

    // 5. Generate new grammar file
    return this.buildGrammarFile(parsed, allPatterns, options);
  }

  private buildGrammarFile(
    parsed: ParsedGrammar,
    patterns: Map<string, string[]>,
    options: ExpansionOptions,
  ): string {
    let output = "// Copyright (c) Microsoft Corporation.\n";
    output += "// Licensed under the MIT License.\n\n";
    output += `// Generated comprehensive grammar - ${new Date().toISOString()}\n`;
    output += `// Generated with scenario-based approach\n`;
    output += `// Total scenarios: ${options.scenarios.length}\n`;
    output += `// Patterns per action: ${patterns.size}\n\n`;

    // Include prefix/suffix library
    if (options.includeCommonPatterns) {
      output += "// Common prefix/suffix patterns\n";
      output += this.loadCommonPatterns();
      output += "\n";
    }

    // Generate rules for each action
    for (const [actionName, actionPatterns] of patterns) {
      const ruleName = this.toRuleName(actionName);
      output += `// ${actionName} - ${actionPatterns.length} patterns\n`;
      output += `<${ruleName}> = \n`;

      // Use prefix/suffix references where applicable
      const withPrefixes = actionPatterns.map((p) =>
        this.applyPrefixSuffixOptimization(p),
      );

      output += withPrefixes
        .map((p, i) => {
          const separator = i < withPrefixes.length - 1 ? " |" : ";";
          return `    ${p}${separator}`;
        })
        .join("\n");

      output += "\n\n";
    }

    // Add <Start> rule
    output += "<Start> = \n";
    const ruleNames = Array.from(patterns.keys()).map((a) =>
      this.toRuleName(a),
    );
    output += ruleNames
      .map((name, i) => {
        const separator = i < ruleNames.length - 1 ? " |" : ";";
        return `    <${name}>${separator}`;
      })
      .join("\n");
    output += "\n";

    return output;
  }

  private applyPrefixSuffixOptimization(pattern: string): string {
    // Detect common prefixes and replace with rule references
    // "could you pause" → "<PolitePrefix_EN>? pause"
    // "pause please" → "pause <PoliteSuffix_EN>?"

    // This is a simplified version - actual implementation would use
    // more sophisticated pattern matching

    const prefixes = [
      ["could you ", "<PolitePrefix_EN>? "],
      ["can you ", "<PolitePrefix_EN>? "],
      ["I want to ", "<DesirePrefix_EN>? "],
      ["I'd like to ", "<DesirePrefix_EN>? "],
    ];

    const suffixes = [
      [" please", " <PoliteSuffix_EN>?"],
      [" thanks", " <PoliteSuffix_EN>?"],
    ];

    let optimized = pattern;
    for (const [original, replacement] of prefixes) {
      if (optimized.startsWith(original)) {
        optimized = replacement + optimized.substring(original.length);
        break;
      }
    }

    for (const [original, replacement] of suffixes) {
      if (optimized.endsWith(original)) {
        optimized =
          optimized.substring(0, optimized.length - original.length) +
          replacement;
        break;
      }
    }

    return optimized;
  }
}

interface ExpansionOptions {
  patternsPerScenario: number; // e.g., 20
  includeFrench: boolean; // true
  includeCommonPatterns: boolean; // true (prefix/suffix library)
  scenarios: ScenarioTemplate[];
}
```

#### Phase 5: Output Validation

```typescript
interface ValidationReport {
  action: string;
  totalPatterns: number;
  validPatterns: number;
  duplicatesRemoved: number;
  coverageScore: number; // 0-1, estimated coverage
  samplePatterns: string[]; // Top 10 by diversity
  warnings: string[];
  errors: string[];
}

class GrammarValidator {
  async validateExpandedGrammar(
    grammarContent: string,
    actionMetadata: ActionMetadata[],
  ): Promise<ValidationReport[]> {
    const reports: ValidationReport[] = [];

    for (const action of actionMetadata) {
      const patterns = this.extractPatternsForAction(
        grammarContent,
        action.actionName,
      );

      const report: ValidationReport = {
        action: action.actionName,
        totalPatterns: patterns.length,
        validPatterns: 0,
        duplicatesRemoved: 0,
        coverageScore: 0,
        samplePatterns: [],
        warnings: [],
        errors: [],
      };

      // Validate each pattern compiles
      for (const pattern of patterns) {
        try {
          const nfa = compilePatternToNFA(pattern);
          report.validPatterns++;
        } catch (e) {
          report.errors.push(
            `Pattern "${pattern}" failed to compile: ${e.message}`,
          );
        }
      }

      // Check for required parameters
      for (const param of action.parameters.filter((p) => !p.optional)) {
        const patternsWithParam = patterns.filter((p) =>
          p.includes(`$(${param.name}`),
        );
        if (patternsWithParam.length === 0) {
          report.errors.push(
            `No patterns include required parameter: ${param.name}`,
          );
        }
      }

      // Estimate coverage (heuristic)
      report.coverageScore = this.estimateCoverage(patterns);

      // Sample diverse patterns
      report.samplePatterns = this.selectDiverseSamples(patterns, 10);

      reports.push(report);
    }

    return reports;
  }

  private estimateCoverage(patterns: string[]): number {
    // Heuristic: more patterns = better coverage, with diminishing returns
    // Target: 100+ patterns = ~0.9 coverage
    const base = Math.min(patterns.length / 100, 1.0);

    // Bonus for diversity (different structures)
    const structures = new Set(patterns.map((p) => this.getStructure(p)));
    const diversityBonus = Math.min(structures.size / 50, 0.1);

    return Math.min(base + diversityBonus, 1.0);
  }

  private getStructure(pattern: string): string {
    // Reduce pattern to structural skeleton
    // "could you pause the music" → "PREFIX pause SUFFIX"
    return pattern
      .replace(/\$\([^)]+\)/g, "WILDCARD")
      .replace(/\(.*?\)\?/g, "OPT")
      .split(/\s+/)
      .slice(0, 3) // First 3 tokens
      .join(" ");
  }
}
```

### 5. Example Output

**Before (playerSchema.agr):**

```
<Pause> = pause ((the)? music)? -> { actionName: "pause" };
<Resume> = resume ((the)? music)? -> { actionName: "resume" };
```

**After (playerSchema.generated.agr):**

```
// Generated comprehensive grammar - 2026-01-30
// Scenarios: 8 (morning-routine, work-focus, exercise, cooking, social, relaxation, discovery, commuting)
// Total patterns: 847

// Common prefix/suffix patterns
<PolitePrefix_EN> = (can you)? (please)? | could you (please)? | would you (please)? | ...;
<DesirePrefix_EN> = I want to | I'd like to | I need to | ...;
<PoliteSuffix_EN> = please | thank you | for me | ...;

// pause - 106 patterns
<Pause> =
    <PolitePrefix_EN>? pause ((the)? music)? <PoliteSuffix_EN>? -> { actionName: "pause" }
  | <DesirePrefix_EN> pause ((the)? music)? <PoliteSuffix_EN>? -> { actionName: "pause" }
  | hit pause -> { actionName: "pause" }
  | hold on -> { actionName: "pause" }
  | wait -> { actionName: "pause" }
  | stop (the)? music -> { actionName: "pause" }
  | hang on -> { actionName: "pause" }
  | pause this -> { actionName: "pause" }
  | pause playback -> { actionName: "pause" }
  | freeze -> { actionName: "pause" }
  | stop playing -> { actionName: "pause" }
  | cut the music -> { actionName: "pause" }
  | I need to pause -> { actionName: "pause" }
  | someone's at the door -> { actionName: "pause" }
  | phone call -> { actionName: "pause" }
  | (my)? meeting (is)? starting -> { actionName: "pause" }
  | quiet please -> { actionName: "pause" }
  | shh -> { actionName: "pause" }
  // ... 88 more patterns

  // French patterns (10%)
  | pause -> { actionName: "pause" }
  | arrête (la)? musique -> { actionName: "pause" }
  | mets en pause -> { actionName: "pause" }
  | pouvez-vous mettre en pause -> { actionName: "pause" }
  // ... 8 more French patterns
  ;

// resume - 94 patterns
<Resume> =
    <PolitePrefix_EN>? resume ((the)? music)? <PoliteSuffix_EN>? -> { actionName: "resume" }
  | <DesirePrefix_EN> resume ((the)? music)? <PoliteSuffix_EN>? -> { actionName: "resume" }
  | keep playing -> { actionName: "resume" }
  | continue -> { actionName: "resume" }
  | play again -> { actionName: "resume" }
  | unpause -> { actionName: "resume" }
  | back to the music -> { actionName: "resume" }
  | (let's)? continue (the)? music -> { actionName: "resume" }
  | start (it)? again -> { actionName: "resume" }
  // ... 85 more patterns
  ;
```

## Implementation Plan

### Week 1: Foundation

- [ ] Create commonPrefixes.agr with EN/FR prefix/suffix rules
- [ ] Define scenario templates for player, calendar, list agents
- [ ] Implement ScenarioTemplate data structure
- [ ] Set up LLM integration (OpenAI/Azure)

### Week 2: Generation Pipeline

- [ ] Build LLMPatternGenerator
- [ ] Implement PatternValidator
- [ ] Create GrammarOptimizer (deduplication)
- [ ] Test on player agent (1 action, 3 scenarios)

### Week 3: Scale Up

- [ ] Generate patterns for all player actions
- [ ] Generate patterns for all calendar actions
- [ ] Generate patterns for all list actions
- [ ] Run validation reports

### Week 4: Refinement

- [ ] Manual review of sample patterns
- [ ] Iterate on prompts based on quality
- [ ] Adjust prefix/suffix extraction
- [ ] Generate final candidate grammars

### Week 5: Testing & Deployment

- [ ] Compile to NFA/DFA
- [ ] Performance testing
- [ ] Coverage testing with real queries
- [ ] Side-by-side comparison with old grammars
- [ ] Deploy as opt-in beta

## Success Metrics

### Coverage Targets

- **Player:** 90%+ of common music control requests
- **Calendar:** 85%+ of common scheduling requests
- **List:** 95%+ of common list operations

### Pattern Counts (per action)

- **Simple actions** (pause, resume): 80-120 patterns
- **Parameterized actions** (play track, add event): 150-250 patterns
- **Complex actions** (search, filter): 100-180 patterns

### Language Split

- **English:** ~90% of patterns
- **French:** ~10% of patterns

### Quality Metrics

- **Compilation rate:** 98%+ patterns compile successfully
- **Parameter coverage:** 100% required parameters in at least 80% of patterns
- **Diversity score:** 40+ unique structural patterns per action

## Next Steps

1. Review scenario templates with domain experts
2. Select initial LLM model (GPT-4 Turbo recommended for quality)
3. Create pilot with player agent "pause" action
4. Iterate on prompt engineering
5. Scale to full agent grammars
6. Deploy and measure real-world coverage improvement
