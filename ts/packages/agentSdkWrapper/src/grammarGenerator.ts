// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { query } from "@anthropic-ai/claude-agent-sdk";
import { GrammarTestCase } from "./testTypes.js";
import { SchemaInfo, ActionInfo, getWildcardType } from "./schemaReader.js";

/**
 * Linguistic analysis of the request
 */
export interface RequestAnalysis {
    // Sentences in the request
    sentences: Sentence[];
}

export interface Sentence {
    // The sentence text
    text: string;
    // S-expression style parse showing dependencies and parts of speech
    parse: string;
    // Tokens with their grammatical roles
    tokens: Token[];
}

export interface Token {
    text: string;
    pos: string; // part of speech (noun, verb, adj, etc.)
    role: string; // grammatical role (subject, object, modifier, etc.)
    dependencies: number[]; // indices of tokens this depends on
}

/**
 * Mapping from request parts to action parameters
 */
export interface ParameterMapping {
    parameterName: string;
    // The source text from the request
    sourceText: string;
    // The target value in the action
    targetValue: any;
    // What conversion is needed (if any)
    conversion?: Conversion;
    // Whether this should be a wildcard or fixed text
    isWildcard: boolean;
}

export interface Conversion {
    type:
        | "none"
        | "string-to-number"
        | "string-to-boolean"
        | "parse-ordinal"
        | "custom";
    description: string;
}

/**
 * Result of analyzing a request/action pair
 */
export interface GrammarAnalysis {
    // Whether a grammar rule should be generated
    shouldGenerateGrammar: boolean;
    // Reason why grammar should not be generated (if applicable)
    rejectionReason?: string;
    // Linguistic analysis of the request
    requestAnalysis: RequestAnalysis;
    // How parameters map from request to action
    parameterMappings: ParameterMapping[];
    // Parts of the request that should be fixed (not wildcards)
    fixedPhrases: string[];
    // The generated grammar pattern (empty if shouldGenerateGrammar is false)
    grammarPattern: string;
    // Reasoning about the choices made
    reasoning: string;
}

const GRAMMAR_GENERATION_SYSTEM_PROMPT = `You are an expert at analyzing natural language requests and generating grammar patterns for action-based systems.

Your task is to:
1. Parse the request linguistically (parts of speech, dependencies)
2. Map request phrases to action parameters
3. Identify what conversions are needed
4. Generate a grammar pattern that captures the structure

CRITICAL RULES:
- Interrogative words (what, where, when, who, why, how, which) must NEVER be wildcards - they must be FIXED
- Articles (the, a, an) should generally be FIXED, not wildcards
- Only the actual variable content (names, numbers, values) should be wildcards
- Be explicit about conversions from source text to parameter values

REJECTION CASES - DO NOT generate grammar when:
1. Adjacent UNQUALIFIED wildcards: Two plain string wildcards next to each other with no fixed separator
   - BAD: "invite $(description:EventDescription) $(participant:ParticipantName)" - ambiguous boundary between unqualified strings
   - OK: "$(trackName:string) by $(artist:string)" - "by" separates them
   - OK: "$(trackName:string) $(artist:string)" - BOTH have checked_wildcard validation, so QUALIFIED and OK
   - OK: "play on $(deviceName:MusicDevice)" - entity type provides validation, so QUALIFIED and OK
   - The key: wildcards with entity types OR paramSpec validation (checked_wildcard, ordinal, etc.) are QUALIFIED
2. Third-person referential pronouns requiring conversation history:
   - "it", "that", "this", "them", "those", "these" - require prior context to resolve
   - Example: "add it to playlist" - "it" refers to current track from history
   - Example: "schedule that for tomorrow" - "that" refers to previous event mentioned
   - IMPORTANT EXCEPTIONS - These pronouns ARE acceptable:
     * First-person (I, me, my, we, us, our) - refers to current user (always available)
     * Second-person (you, your) - refers to the system
     * Any pronoun in a completely fixed phrase (not a wildcard): "what do I have today" is fine
3. Query/search parameters: Parameters that capture arbitrary text without validation
   - "query", "search", "filter" parameters are too open-ended
   - Example: "search for rock music" - "query" could be anything
4. Missing critical context beyond current user: Request depends on conversation history
   - Example: "play that again" - "that" requires knowing what was played before
   - Note: Current user context (I, me, my) is always available and not considered "missing"

When rejecting, set shouldGenerateGrammar=false and provide rejectionReason.

OPTIONAL PHRASES:
Politeness phrases and conversational variations should be marked as optional using ()?:
- Single word: (please)? or (the)?
- Multiple words: (would you)? or (could you please)?
- Examples:
  - "play the song" + "play song" → "play (the)? song"
  - "please play" + "play" → "(please)? play"
  - "would you please play" + "play" → "(would you please)? play" OR "(would you)? (please)? play"

Response format: JSON with this structure:

ACCEPT CASE (grammar should be generated):
{
  "shouldGenerateGrammar": true,
  "requestAnalysis": {
    "sentences": [{
      "text": "...",
      "parse": "(S (WH what) (VP (V is) (NP (DET the) (N weather) (PP (P in) (NP Seattle)))))",
      "tokens": [
        {"text": "what", "pos": "WH", "role": "interrogative", "dependencies": []},
        {"text": "is", "pos": "V", "role": "copula", "dependencies": [0]},
        ...
      ]
    }]
  },
  "parameterMappings": [
    {
      "parameterName": "location",
      "sourceText": "Seattle",
      "targetValue": "Seattle",
      "conversion": {"type": "none", "description": "Direct string match"},
      "isWildcard": true
    }
  ],
  "fixedPhrases": ["what's the weather in"],
  "grammarPattern": "what's the weather in $(location:string)",
  "reasoning": "The interrogative 'what' and the core phrase 'the weather in' are fixed. Only the location name varies."
}

REJECT CASE (grammar should NOT be generated):
{
  "shouldGenerateGrammar": false,
  "rejectionReason": "Adjacent unqualified wildcards without separator: description and participant have no fixed word between them and neither has validation, making boundary ambiguous",
  "requestAnalysis": { ... },
  "parameterMappings": [ ... ],
  "fixedPhrases": [],
  "grammarPattern": "",
  "reasoning": "This pattern would create $(description:EventDescription) $(participant:ParticipantName) which cannot reliably parse where description ends and participant begins, since both are unqualified string wildcards."
}`;

export class ClaudeGrammarGenerator {
    private model: string;

    constructor(model: string = "claude-sonnet-4-20250514") {
        this.model = model;
    }

    async generateGrammar(
        testCase: GrammarTestCase,
        schemaInfo: SchemaInfo,
    ): Promise<GrammarAnalysis> {
        const actionInfo = schemaInfo.actions.get(testCase.action.actionName);
        if (!actionInfo) {
            throw new Error(`Action not found: ${testCase.action.actionName}`);
        }

        const prompt = this.buildPrompt(testCase, actionInfo, schemaInfo);

        // Use the Agent SDK query function
        const queryInstance = query({
            prompt: `${GRAMMAR_GENERATION_SYSTEM_PROMPT}\n\n${prompt}`,
            options: {
                model: this.model,
            },
        });

        // Collect the result from the SDK
        let responseText = "";
        for await (const message of queryInstance) {
            if (message.type === "result") {
                if (message.subtype === "success") {
                    responseText = message.result || "";
                    break;
                } else {
                    const errors =
                        "errors" in message
                            ? (message as any).errors
                            : undefined;
                    throw new Error(
                        `Claude query failed: ${errors?.join(", ") || "Unknown error"}`,
                    );
                }
            }
        }

        if (!responseText) {
            throw new Error("No response from Claude");
        }

        return this.parseAnalysis(responseText);
    }

    private buildPrompt(
        testCase: GrammarTestCase,
        actionInfo: ActionInfo,
        schemaInfo: SchemaInfo,
    ): string {
        let prompt = `Analyze this request and generate a grammar pattern:\n\n`;
        prompt += `Request: "${testCase.request}"\n\n`;
        prompt += `Action: ${testCase.action.actionName}\n`;
        prompt += `Parameters:\n`;

        for (const [paramName, paramValue] of Object.entries(
            testCase.action.parameters,
        )) {
            const paramInfo = actionInfo.parameters.get(paramName);
            const wildcardType = paramInfo
                ? getWildcardType(paramInfo)
                : "string";
            const paramSpec = paramInfo?.paramSpec || "none";
            const entityType = paramInfo?.isEntityType
                ? ` (entity type: ${paramInfo.entityTypeName})`
                : "";

            prompt += `  - ${paramName}: ${JSON.stringify(paramValue)} [type: ${wildcardType}, spec: ${paramSpec}${entityType}]\n`;
        }

        if (schemaInfo.entityTypes.size > 0) {
            prompt += `\nAvailable entity types: ${Array.from(schemaInfo.entityTypes).join(", ")}\n`;
        }

        if (schemaInfo.converters.size > 0) {
            prompt += `\nBuilt-in converters/parsers available:\n`;
            for (const [entityType, converter] of schemaInfo.converters) {
                prompt += `  ${entityType} (${converter.name}):\n`;
                prompt += `    ${converter.description}\n`;
                prompt += `    Examples: ${converter.examples.join(", ")}\n`;
            }
        }

        prompt += `\nSteps to follow:\n`;
        prompt += `1. Parse the request linguistically:\n`;
        prompt += `   - Break into sentences\n`;
        prompt += `   - Identify parts of speech for each word\n`;
        prompt += `   - Show dependencies between words\n`;
        prompt += `   - Express as S-expression parse tree\n\n`;

        prompt += `2. Map request phrases to parameters:\n`;
        prompt += `   - Identify which part of the request corresponds to each parameter\n`;
        prompt += `   - Determine if any conversion is needed (e.g., "third" -> 3)\n`;
        prompt += `   - Mark whether each should be a wildcard or fixed text\n\n`;

        prompt += `3. Identify fixed vs optional phrases:\n`;
        prompt += `   - Interrogative words MUST be fixed (never optional)\n`;
        prompt += `   - Core action words and structural words should be fixed\n`;
        prompt += `   - Politeness phrases (please, would you, could you) should be OPTIONAL\n`;
        prompt += `   - Articles can be optional if both forms are natural ("the weather" vs "weather")\n`;
        prompt += `   - Only actual values should be wildcards\n\n`;

        prompt += `4. Generate the grammar pattern:\n`;
        prompt += `   - Use $(paramName:type) for wildcards\n`;
        prompt += `   - Use (phrase)? for optional parts\n`;
        prompt += `   - Include fixed phrases exactly as they appear\n`;
        prompt += `   - Use the correct type from the parameter spec\n`;
        prompt += `   - Examples:\n`;
        prompt += `     * "(please)? play $(track:string)" - matches "play X" or "please play X"\n`;
        prompt += `     * "(would you)? (please)? show" - matches "show", "please show", "would you show", "would you please show"\n\n`;

        prompt += `Conversion types available:\n`;
        prompt += `- "none": Direct string match\n`;
        prompt += `- "string-to-number": Convert text like "50" to number 50\n`;
        prompt += `- "parse-ordinal": Convert "third" to 3, "fifth" to 5, etc.\n`;
        prompt += `- "string-to-boolean": Convert "on"/"off", "yes"/"no" to boolean\n`;
        prompt += `- "custom": Other conversions (describe what's needed)\n`;

        return prompt;
    }

    private parseAnalysis(text: string): GrammarAnalysis {
        // Extract JSON from response - find the largest valid JSON object
        let jsonText = "";
        let braceCount = 0;
        let startIndex = -1;

        for (let i = 0; i < text.length; i++) {
            if (text[i] === "{") {
                if (braceCount === 0) {
                    startIndex = i;
                }
                braceCount++;
            } else if (text[i] === "}") {
                braceCount--;
                if (braceCount === 0 && startIndex !== -1) {
                    jsonText = text.substring(startIndex, i + 1);
                    break;
                }
            }
        }

        if (!jsonText) {
            throw new Error("No JSON found in Claude response");
        }

        const analysis = JSON.parse(jsonText);

        // Validate required fields
        if (analysis.shouldGenerateGrammar === undefined) {
            throw new Error("Missing shouldGenerateGrammar field");
        }

        if (!analysis.requestAnalysis || !analysis.reasoning) {
            throw new Error("Missing required fields in analysis");
        }

        // For rejected cases, we still need basic structure but not full analysis
        if (!analysis.shouldGenerateGrammar && !analysis.rejectionReason) {
            throw new Error("Rejected cases must include rejectionReason");
        }

        return analysis;
    }

    /**
     * Convert the analysis into a full .agr format grammar rule
     * Returns empty string if grammar should not be generated
     *
     * Uses the exact action name as the rule name (e.g., @ <scheduleEvent> = ...)
     * to enable easy targeting when extending grammars for specific actions.
     */
    formatAsGrammarRule(
        testCase: GrammarTestCase,
        analysis: GrammarAnalysis,
    ): string {
        if (!analysis.shouldGenerateGrammar) {
            return `# REJECTED: ${analysis.rejectionReason}`;
        }

        const actionName = testCase.action.actionName;
        // Use exact action name as rule name for easy targeting
        let grammar = `@ <${actionName}> = `;
        grammar += analysis.grammarPattern;
        grammar += ` -> {\n`;
        grammar += `    actionName: "${actionName}"`;

        if (Object.keys(testCase.action.parameters).length > 0) {
            grammar += `,\n    parameters: {\n`;

            const paramLines: string[] = [];
            for (const mapping of analysis.parameterMappings) {
                if (mapping.isWildcard) {
                    if (Array.isArray(mapping.targetValue)) {
                        paramLines.push(
                            `        ${mapping.parameterName}: [$(${mapping.parameterName})]`,
                        );
                    } else {
                        paramLines.push(
                            `        ${mapping.parameterName}: $(${mapping.parameterName})`,
                        );
                    }
                } else {
                    // Fixed value
                    const value = JSON.stringify(mapping.targetValue);
                    paramLines.push(
                        `        ${mapping.parameterName}: ${value}`,
                    );
                }
            }

            grammar += paramLines.join(",\n");
            grammar += `\n    }`;
        }

        grammar += `\n}`;

        return grammar;
    }
}
