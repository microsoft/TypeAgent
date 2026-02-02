// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { query } from "@anthropic-ai/claude-agent-sdk";
import { GrammarTestCase } from "./testTypes.js";
import { SchemaInfo, ActionInfo, getWildcardType } from "./schemaReader.js";

/**
 * Structured grammar rule right-hand side
 */
export interface RuleRHS {
    // The grammar pattern like "play $(track:wildcard) by $(artist:wildcard)"
    matchPattern: string;
    // Parameters that map to the action
    actionParameters: Array<{
        parameterName: string;
        parameterValue: string; // e.g., "$(track)" or fixed value like "kitchen"
    }>;
}

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
    // The generated grammar pattern (structured with matchPattern and actionParameters)
    grammarPattern: RuleRHS;
    // Reasoning about the choices made
    reasoning: string;
}

const GRAMMAR_GENERATION_SYSTEM_PROMPT = `You are a grammar pattern generator. Your job is to create a pattern, specifically the right-hand-side of a grammar rule, that matches natural language requests to actions.

WILDCARD RULES:
1. Variable content (names, values, numbers) = wildcards
2. Structure words (the, a, in, by, to, for, etc.) = fixed text
3. Question words (what, where, when, who, why, how) = fixed text
4. For array parameters: if only one item is given, use singular variable name
   - Example Pattern: "by $(artist:EntityType)" → maps to artists: [$(artist)]

WILDCARD TYPES:
- Entity types (capitalized): $(varName:MusicDevice), $(varName:CalendarDate)
- ParamSpec types (lowercase): $(varName:number), $(varName:ordinal), $(varName:percentage)
- Validated wildcards: $(varName:wildcard) - when marked "(validated)" and no entity type
- CRITICAL: ParamSpec types MUST be lowercase: "number" not "Number", "ordinal" not "Ordinal"
- CRITICAL: Only use entity types that are explicitly listed in the schema
- CRITICAL: Use "wildcard" (not "string") for multi-word captures without entity types

REJECT when:
1. Adjacent UNVALIDATED wildcards with NO FIXED TEXT between them
   - "Adjacent" means wildcards directly next to each other with only whitespace between
   - Wildcards separated by fixed words (by, to, from, in, on, etc.) are NOT adjacent
   - ACCEPT: "invite $(name) to $(event)" - "to" separates them, not adjacent
   - ACCEPT: "play $(track) by $(artist)" - "by" separates them, not adjacent
   - ACCEPT: "play $(track) $(artist)" if AT LEAST ONE is validated (can parse validated first, then remainder)
   - REJECT: "play $(track) $(artist)" if NEITHER is validated (ambiguous without separator or validation)
2. References to conversation history: "it", "that", "this", "them"

ACCEPT in all other cases.

OUTPUT FORMAT (TypeScript interface):

interface RuleRHS {
    matchPattern: string;  // The grammar pattern like "play $(track:wildcard) by $(artist:wildcard)"
    actionParameters: Array<{
        parameterName: string;
        parameterValue: string; // e.g., "$(track)" or fixed value like "kitchen"
    }>;
}
    
Your output MUST be a JSON object matching the following TypeScript interface:
interface GrammarAnalysis {
  shouldGenerateGrammar: boolean;
  rejectionReason?: string;  // Only if shouldGenerateGrammar = false
  requestAnalysis: {
    sentences: Array<{
      text: string;
      parse: string;  // Simple parse like "(request (verb) (params))"
      tokens: Array<{ text: string; pos: string; role: string; dependencies: number[] }>;
    }>;
  };
  parameterMappings: Array<{
    parameterName: string;
    sourceText: string;
    targetValue: any;
    conversion?: { type: string; description: string };
    isWildcard: boolean;
  }>;
  fixedPhrases: string[];
  grammarPattern: RuleRHS;  // The actual pattern like "play $(track:TrackName) by $(artist:ArtistName)"
  reasoning: string;
}

CRITICAL OUTPUT RULES:
- Output ONLY valid JSON matching the interface above
- NO markdown, NO comments, NO extra text before or after, NO undefined or null values
- Start with { and end with }
- Use exact entity type names from the schema (case-sensitive)

EXAMPLE 1 (Entity type):

Request: "select kitchen device"
Action: selectDevice
Parameters: { deviceName: "kitchen" }
Entity types available: MusicDevice

Output:
{
  "shouldGenerateGrammar": true,
  "requestAnalysis": { "sentences": [{ "text": "select kitchen device", "parse": "(S (V select) (NP device))", "tokens": [] }] },
  "parameterMappings": [
    { "parameterName": "deviceName", "sourceText": "kitchen", "targetValue": "kitchen", "isWildcard": true }
  ],
  "fixedPhrases": ["select", "device"],
  "grammarPattern": { "matchPattern": "select $(deviceName:MusicDevice) device", "actionParameters": [ { "parameterName": "deviceName", "parameterValue": "$(deviceName)" } ] },
  "reasoning": "Fixed structure 'select...device'. Parameter deviceName has entity type MusicDevice."
}

EXAMPLE 2 (Validated wildcards):

Request: "play bohemian rhapsody by queen"
Action: playTrack
Parameters: { trackName: "bohemian rhapsody" (validated), artists: ["queen"] (validated) }

Output:
{
  "shouldGenerateGrammar": true,
  "requestAnalysis": { "sentences": [{ "text": "play bohemian rhapsody by queen", "parse": "(S (V play) (NP track) (PP by artist))", "tokens": [] }] },
  "parameterMappings": [
    { "parameterName": "trackName", "sourceText": "bohemian rhapsody", "targetValue": "bohemian rhapsody", "isWildcard": true },
    { "parameterName": "artists", "sourceText": "queen", "targetValue": ["queen"], "isWildcard": true }
  ],
  "fixedPhrases": ["play", "by"],
  "grammarPattern": { "matchPattern": "play $(trackName:wildcard) by $(artist:wildcard)", "actionParameters": [ { "parameterName": "trackName", "parameterValue": "$(trackName)" }, { "parameterName": "artists", "parameterValue": "[$(artist)]" } ] },
  "reasoning": "Fixed structure 'play...by'. Both parameters are validated so adjacent wildcards are OK. Use singular 'artist' for array parameter 'artists'."
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

            // Format the expected wildcard pattern
            const isArray = Array.isArray(paramValue);
            const varName = isArray
                ? this.getSingularVariableName(paramName)
                : paramName;

            // Use getWildcardType to determine the correct type (handles entity types, paramSpecs, and defaults)
            const wildcardType = paramInfo
                ? getWildcardType(paramInfo)
                : "string";
            const expectedPattern = `$(${varName}:${wildcardType})`;

            // Check if this parameter is validated (has checked_wildcard paramSpec)
            const isValidated = paramInfo?.paramSpec === "checked_wildcard";

            prompt += `  - ${paramName}: ${JSON.stringify(paramValue)}`;
            if (isArray) {
                prompt += ` (ARRAY)`;
            }
            if (isValidated) {
                prompt += ` (validated)`;
            }
            prompt += ` → USE: ${expectedPattern}\n`;
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

        prompt += `\nYOUR TASK:\n`;
        prompt += `Generate a grammarPattern that matches the request structure.\n\n`;

        prompt += `PATTERN RULES:\n`;
        prompt += `1. Fixed text: action words and structure (play, by, to, from, etc.)\n`;
        prompt += `2. Wildcards: variable content only\n`;
        prompt += `   Format: $(varName:TypeName)\n`;
        prompt += `   - For parameters WITH entity type: use that exact entity type name\n`;
        prompt += `   - For parameters WITHOUT entity type: use "wildcard"\n`;
        prompt += `   - For array parameters: use SINGULAR variable name\n`;
        prompt += `3. Keep the pattern simple and direct\n`;
        prompt += `4. Adjacent wildcards:\n`;
        prompt += `   - Parameters marked "(validated)" are checked against real data (e.g., Spotify API)\n`;
        prompt += `   - Adjacent wildcards are OK if AT LEAST ONE is validated (parse validated first, then remainder)\n`;
        prompt += `   - Adjacent wildcards with NO validated parameters need a separator or structure\n\n`;

        prompt += `CRITICAL - Entity Type Usage:\n`;
        prompt += `Look at the parameter info above.\n`;
        prompt += `- If it says "→ USE: $(varName:EntityType)" where EntityType is NOT "wildcard", use that EXACT entity type\n`;
        prompt += `- If it says "→ USE: $(varName:wildcard)", the parameter is validated but has no entity type\n`;
        prompt += `- If it says "(validated)", the parameter is checked against real data\n`;
        prompt += `Example:\n`;
        prompt += `  Parameter: deviceName "kitchen" → USE: $(deviceName:MusicDevice)\n`;
        prompt += `  Correct pattern: $(deviceName:MusicDevice)\n`;
        prompt += `  Wrong: $(deviceName:wildcard) or $(device:MusicDevice)\n\n`;

        return prompt;
    }

    private parseAnalysis(text: string): GrammarAnalysis {
        // Remove any leading non-JSON content (comments, markdown, etc.)
        // Look for the first '{' character which starts the JSON object
        const jsonStart = text.indexOf("{");
        if (jsonStart === -1) {
            throw new Error(
                `No JSON object found in Claude response. Response starts with: "${text.substring(0, 100)}..."`,
            );
        }

        // If there's content before the JSON, log a warning but continue
        if (jsonStart > 0) {
            const preamble = text.substring(0, jsonStart).trim();
            if (preamble.length > 0) {
                console.warn(
                    `[Grammar Generation] Claude included text before JSON: "${preamble.substring(0, 100)}..."`,
                );
            }
        }

        // Extract JSON from response - find matching braces
        let jsonText = "";
        let braceCount = 0;
        let startIndex = jsonStart;

        for (let i = jsonStart; i < text.length; i++) {
            if (text[i] === "{") {
                braceCount++;
            } else if (text[i] === "}") {
                braceCount--;
                if (braceCount === 0) {
                    jsonText = text.substring(startIndex, i + 1);
                    break;
                }
            }
        }

        if (!jsonText) {
            throw new Error(
                `Found opening brace but no matching closing brace in Claude response. Text from brace: "${text.substring(jsonStart, jsonStart + 100)}..."`,
            );
        }

        let analysis;
        try {
            analysis = JSON.parse(jsonText);
        } catch (error) {
            throw new Error(
                `Failed to parse JSON from Claude response: ${error instanceof Error ? error.message : String(error)}\nJSON text preview: ${jsonText.substring(0, 300)}...\nFull response preview: ${text.substring(0, 300)}...`,
            );
        }

        // Validate required fields
        if (analysis.shouldGenerateGrammar === undefined) {
            throw new Error(
                `Missing shouldGenerateGrammar field. Received fields: ${Object.keys(analysis).join(", ")}\nParsed object: ${JSON.stringify(analysis).substring(0, 500)}...`,
            );
        }

        if (!analysis.requestAnalysis || !analysis.reasoning) {
            throw new Error(
                `Missing required fields in analysis. Received fields: ${Object.keys(analysis).join(", ")}`,
            );
        }

        // For rejected cases, we still need basic structure but not full analysis
        if (!analysis.shouldGenerateGrammar && !analysis.rejectionReason) {
            throw new Error("Rejected cases must include rejectionReason");
        }

        // Clean up any unwanted text that Claude might have inserted into string fields
        this.sanitizeAnalysisStrings(analysis);

        return analysis;
    }

    /**
     * Remove copyright notices, comments, and other unwanted text from analysis string fields
     * Claude sometimes inserts these into the JSON, making the grammar patterns invalid
     */
    private sanitizeAnalysisStrings(analysis: GrammarAnalysis): void {
        const commentPatterns = [
            /\/\/\s*Copyright[^\n]*/gi, // // Copyright...
            /\/\*\s*Copyright[\s\S]*?\*\//gi, // /* Copyright... */
            /^\/\/[^\n]*/gm, // Any line starting with //
        ];

        const cleanString = (str: string | undefined): string | undefined => {
            if (!str) return str;

            let cleaned = str;
            let hadComments = false;

            for (const pattern of commentPatterns) {
                const before = cleaned;
                cleaned = cleaned.replace(pattern, "").trim();
                if (cleaned !== before) {
                    hadComments = true;
                }
            }

            if (hadComments) {
                console.warn(
                    `[Grammar Generation] Removed comment/copyright text from Claude response. Original: "${str.substring(0, 100)}..."`,
                );
            }

            return cleaned;
        };

        // Clean critical string fields in RuleRHS structure
        if (analysis.grammarPattern) {
            if (analysis.grammarPattern.matchPattern) {
                const cleaned = cleanString(
                    analysis.grammarPattern.matchPattern,
                );
                if (cleaned !== undefined) {
                    analysis.grammarPattern.matchPattern = cleaned;
                }
            }
            // Clean actionParameters array
            if (analysis.grammarPattern.actionParameters) {
                for (const param of analysis.grammarPattern.actionParameters) {
                    if (param.parameterValue) {
                        const cleaned = cleanString(param.parameterValue);
                        if (cleaned !== undefined) {
                            param.parameterValue = cleaned;
                        }
                    }
                }
            }
        }
        if (analysis.rejectionReason) {
            const cleaned = cleanString(analysis.rejectionReason);
            if (cleaned !== undefined) {
                analysis.rejectionReason = cleaned;
            }
        }
        if (analysis.reasoning) {
            const cleaned = cleanString(analysis.reasoning);
            if (cleaned !== undefined) {
                analysis.reasoning = cleaned;
            }
        }

        // Clean parameter mapping strings
        if (analysis.parameterMappings) {
            for (const mapping of analysis.parameterMappings) {
                if (mapping.sourceText) {
                    const cleaned = cleanString(mapping.sourceText);
                    if (cleaned !== undefined) {
                        mapping.sourceText = cleaned;
                    }
                }
                if (mapping.conversion?.description) {
                    const cleaned = cleanString(mapping.conversion.description);
                    if (cleaned !== undefined) {
                        mapping.conversion.description = cleaned;
                    }
                }
            }
        }

        // Clean fixed phrases
        if (analysis.fixedPhrases) {
            analysis.fixedPhrases = analysis.fixedPhrases
                .map((phrase) => cleanString(phrase))
                .filter(
                    (phrase): phrase is string =>
                        phrase !== undefined && phrase.length > 0,
                );
        }
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
        schemaInfo: SchemaInfo,
    ): string {
        if (!analysis.shouldGenerateGrammar) {
            return `# REJECTED: ${analysis.rejectionReason}`;
        }

        const actionName = testCase.action.actionName;
        const actionInfo = schemaInfo.actions.get(actionName);

        // Build a map of wildcard variable names to their correct types (entity types, paramSpecs, or string)
        const wildcardTypes = new Map<string, string>();
        if (actionInfo) {
            for (const mapping of analysis.parameterMappings) {
                if (mapping.isWildcard) {
                    const paramInfo = actionInfo.parameters.get(
                        mapping.parameterName,
                    );
                    if (paramInfo) {
                        // For array parameters, use singular variable name
                        const varName = Array.isArray(mapping.targetValue)
                            ? this.getSingularVariableName(
                                  mapping.parameterName,
                              )
                            : mapping.parameterName;

                        // Use getWildcardType to get correct type (entity type, paramSpec, or string)
                        const wildcardType = getWildcardType(paramInfo);
                        wildcardTypes.set(varName, wildcardType);
                    }
                }
            }
        }

        // Replace types in the matchPattern
        let matchPattern = analysis.grammarPattern.matchPattern;
        for (const [varName, wildcardType] of wildcardTypes) {
            // Replace $(varName:string) or $(varName:wildcard) with $(varName:CorrectType)
            // Note: "string" support is for backwards compatibility; Claude should now output "wildcard"
            const stringPattern = new RegExp(`\\$\\(${varName}:string\\)`, "g");
            matchPattern = matchPattern.replace(
                stringPattern,
                `$(${varName}:${wildcardType})`,
            );
            const wildcardPattern = new RegExp(`\\$\\(${varName}:wildcard\\)`, "g");
            matchPattern = matchPattern.replace(
                wildcardPattern,
                `$(${varName}:${wildcardType})`,
            );
        }

        // Include <Start> rule that references the action rule
        let grammar = `@ <Start> = <${actionName}>\n`;

        // Use exact action name as rule name for easy targeting
        grammar += `@ <${actionName}> = `;
        grammar += matchPattern;
        grammar += ` -> {\n`;
        grammar += `    actionName: "${actionName}"`;

        // Use actionParameters from the RuleRHS structure
        if (analysis.grammarPattern.actionParameters.length > 0) {
            grammar += `,\n    parameters: {\n`;

            const paramLines: string[] = [];
            for (const param of analysis.grammarPattern.actionParameters) {
                paramLines.push(
                    `        ${param.parameterName}: ${param.parameterValue}`,
                );
            }

            grammar += paramLines.join(",\n");
            grammar += `\n    }`;
        }

        grammar += `\n}`;

        return grammar;
    }

    /**
     * Get singular form of a variable name (e.g., "artists" -> "artist")
     * Simple heuristic: remove trailing 's' if it exists
     */
    private getSingularVariableName(paramName: string): string {
        if (paramName.endsWith("s") && paramName.length > 1) {
            return paramName.slice(0, -1);
        }
        return paramName;
    }
}
