// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { GrammarTestCase } from "./testTypes.js";
import { SchemaInfo, ActionInfo, getWildcardType } from "./schemaReader.js";
import { globalPhraseSetRegistry } from "../builtInPhraseMatchers.js";

const debug = registerDebug("typeagent:actionGrammar:grammarGenerator");

/**
 * Structured grammar rule right-hand side
 */
export interface RuleRHS {
    // The grammar pattern like "play $(track:wildcard) by $(artist:wildcard)"
    matchPattern: string;
    // Parameters that map to the action
    actionParameters: Array<{
        parameterName: string;
        parameterValue: string; // e.g., "track" (bare var name) or fixed value like "kitchen"; arrays: "[artist]"
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
 * A helper rule defined by Claude for this specific grammar (e.g., rule-specific filler)
 */
export interface AdditionalRule {
    /** Rule name without angle brackets, e.g. "ExtraneousPhrase" */
    name: string;
    /** Complete AGR rule text: <Name> = alt1 | alt2 | ... ; */
    ruleText: string;
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
    // Optional: extra rules Claude defined for this grammar (e.g., rule-specific filler)
    additionalRules?: AdditionalRule[];
    // Optional: new phrases to add to global phrase-set matchers (idempotent)
    phrasesToAdd?: Array<{ matcherName: string; phrase: string }>;
}

function buildSystemPrompt(): string {
    const phraseSetDescriptions = globalPhraseSetRegistry.getDescriptions();
    return `You are a grammar pattern generator. Your job is to create a grammar rule that matches natural language requests to actions.

WILDCARD RULES:
1. Variable content (names, values, numbers) = wildcards
2. Structure words (the, a, in, by, to, for, etc.) = fixed text
3. Question words (what, where, when, who, why, how) = fixed text
4. For array parameters: if only one item is given, use singular variable name
   - Example Pattern: "by $(artist:wildcard)" → maps to artists: [artist]

WILDCARD TYPES:
- Built-in entity types: $(varName:CalendarDate), $(varName:CalendarTime), $(varName:CalendarTimeRange), $(varName:Cardinal)
- ParamSpec types: $(varName:ordinal), $(varName:percentage)
- Validated wildcards: $(varName:wildcard) - for checked_wildcard parameters (validated at runtime)
- Plain wildcards: $(varName:wildcard) - default for multi-word captures
- CRITICAL: Use "wildcard" (not "string") for multi-word captures
- CRITICAL: Only use type names that are explicitly listed in the "USE:" directive

AVAILABLE PHRASE-SET MATCHERS:
These are global phrase sets you can reference in your matchPattern using <Name>.
At match time the system tries every phrase in the set at that token position.
The current phrases in each set are listed below.

${phraseSetDescriptions}

PHRASE-SET GUARANTEE — if the specific phrase from the request is NOT listed above:
You MUST add it via phrasesToAdd so future requests are handled too.
  Example: request says "would you mind" → not in Polite list →
    phrasesToAdd: [{ "matcherName": "Polite", "phrase": "would you mind" }]

Do NOT add inline alternatives like (<Polite> | would you mind)? — use phrasesToAdd instead.
Just write (<Polite>)? in the matchPattern and add the phrase to phrasesToAdd.

FILLER WORD GUIDANCE — hesitation sounds and mid-sentence filler ALL belong in FillerWord:
- Hesitation sounds: "aa", "ah", "er", "oh", "uh", "um" → add to FillerWord via phrasesToAdd
- Affirmations used as filler: "yeah", "yep", "yes" when mid-sentence → FillerWord
- Verbal filler phrases: "you know", "i mean", "kind of", "sort of", "i guess" → FillerWord
- Use (<FillerWord>)* (Kleene star, zero-or-more) when multiple fillers can appear in sequence.
  Do NOT chain (<FillerWord>)? (<FillerWord>)? — use * instead.
- Use (...)+ (Kleene plus, one-or-more) when at least one occurrence is required.
- Do NOT define custom rules (e.g. <ConversationalFiller>) for hesitations; use <FillerWord>.

ACKNOWLEDGEMENT/GREETING guidance:
- "ah yes", "yes", "yeah" at the very START of a request → Acknowledgement or Greeting
  → add via phrasesToAdd to the appropriate set.

You may also define NEW rule-specific helper rules for phrases that appear in the request
but don't map to any parameter (e.g., "of fugues", "songs", "tracks"). Put these in
additionalRules in your output — do NOT add them to any phrase-set matcher.
Example: name="ExtraneousPhrase", ruleText="<ExtraneousPhrase> = of fugues;"
Then use (<ExtraneousPhrase>)? in the matchPattern where the phrase appears.

ROUND-TRIP GUARANTEE — your rule MUST match the full request:
After you generate the rule it will be compiled and run against the original request string.
If it fails to match, you will receive the failure details and be asked to fix it.

Every token in the request must be accounted for — either matched by a wildcard, a fixed
word, or a phrase-set/custom category. Use the optional phrase-set matchers for leading/
trailing courtesy words and hesitations. Use additionalRules for request-specific filler.

REJECT ONLY for the following reason (this is an exhaustive list):
1. Adjacent unvalidated wildcards: wildcards next to each other with NO fixed text between them AND NEITHER is marked (validated)
   - If AT LEAST ONE is (validated), you MUST accept — do not reject for adjacency
   - "By", "to", "from", "in", "on" etc. between wildcards = NOT adjacent = always accept

DO NOT REJECT for any other reason. In particular, NEVER reject for:
- Informal, slangy, or conversational language ("yo", "sick tunes", "crank it up")
- Actions with no parameters — generate a fixed-text pattern (e.g. 'pause' → 'pause the music')
- Pronouns like "it", "that", "this", "them" — all parameter values are guaranteed to be in the
  request text, so any pronouns are just in-sentence anaphora; ignore them and build the pattern
  from the explicit values
- Any other reason you might invent

ACCEPT in all other cases — no exceptions.

OUTPUT FORMAT (TypeScript interfaces):

interface RuleRHS {
    matchPattern: string;  // The grammar pattern like "(<Polite>)? play $(track:wildcard) by $(artist:wildcard)"
                           // Quantifiers: (...)? = zero-or-one, (...)* = zero-or-more (Kleene star), (...)+ = one-or-more (Kleene plus)
    actionParameters: Array<{
        parameterName: string;
        parameterValue: string; // e.g., "track" or fixed value "kitchen"; arrays: "[artist]"
    }>;
}

interface AdditionalRule {
    name: string;     // Rule name without angle brackets, e.g. "ExtraneousPhrase"
    ruleText: string; // Complete AGR text: <ExtraneousPhrase> = of fugues;
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
  grammarPattern: RuleRHS;
  additionalRules?: AdditionalRule[];  // Rule-specific helper rules (NOT phrase-set matchers)
  phrasesToAdd?: Array<{ matcherName: string; phrase: string }>;  // New phrases for global sets
  reasoning: string;
}

CRITICAL OUTPUT RULES:
- Output ONLY valid JSON matching the interface above
- NO markdown, NO comments, NO extra text before or after, NO undefined or null values
- Start with { and end with }
- Use exact type names from the "USE:" directive (case-sensitive)

EXAMPLE 1 (Validated wildcard):

Request: "select kitchen device"
Action: selectDevice
Parameters: { deviceName: "kitchen" (validated) } → USE: $(deviceName:wildcard)

Output:
{
  "shouldGenerateGrammar": true,
  "requestAnalysis": { "sentences": [{ "text": "select kitchen device", "parse": "(S (V select) (NP device))", "tokens": [] }] },
  "parameterMappings": [
    { "parameterName": "deviceName", "sourceText": "kitchen", "targetValue": "kitchen", "isWildcard": true }
  ],
  "fixedPhrases": ["select", "device"],
  "grammarPattern": { "matchPattern": "select $(deviceName:wildcard) device", "actionParameters": [ { "parameterName": "deviceName", "parameterValue": "deviceName" } ] },
  "reasoning": "Fixed structure 'select...device'. Parameter deviceName is validated (checked_wildcard), use wildcard type."
}

EXAMPLE 2 (Polite opener + rule-specific filler, phrase already in set):

Request: "please play a couple of fugues by Bach"
Action: playArtist
Parameters: { artist: "Bach" (validated), quantity: 2 } → USE: $(artist:wildcard), $(quantity:Cardinal)

Output:
{
  "shouldGenerateGrammar": true,
  "requestAnalysis": { "sentences": [{ "text": "please play a couple of fugues by Bach", "parse": "(S (Polite please) (V play) (NP quantity artist))", "tokens": [] }] },
  "parameterMappings": [
    { "parameterName": "artist", "sourceText": "Bach", "targetValue": "Bach", "isWildcard": true },
    { "parameterName": "quantity", "sourceText": "a couple", "targetValue": 2, "isWildcard": true }
  ],
  "fixedPhrases": ["play", "by"],
  "grammarPattern": { "matchPattern": "(<Polite>)? play $(quantity:Cardinal) (<ExtraneousPhrase>)? by $(artist:wildcard)", "actionParameters": [ { "parameterName": "quantity", "parameterValue": "quantity" }, { "parameterName": "artist", "parameterValue": "artist" } ] },
  "additionalRules": [ { "name": "ExtraneousPhrase", "ruleText": "<ExtraneousPhrase> = of fugues | songs | tracks;" } ],
  "reasoning": "'please' is already in the Polite set so no phrasesToAdd needed. 'a couple' maps to quantity via Cardinal. 'of fugues' is request-specific filler, captured in ExtraneousPhrase."
}

EXAMPLE 3 (Greeting phrase NOT in set — add via phrasesToAdd):

Request: "hey there, shuffle my playlist"
Action: shufflePlaylist
Parameters: {}

Output:
{
  "shouldGenerateGrammar": true,
  "requestAnalysis": { "sentences": [{ "text": "hey there, shuffle my playlist", "parse": "(S (Greeting hey there) (V shuffle) (NP playlist))", "tokens": [] }] },
  "parameterMappings": [],
  "fixedPhrases": ["shuffle", "my", "playlist"],
  "grammarPattern": { "matchPattern": "(<Greeting>)? shuffle my playlist", "actionParameters": [] },
  "phrasesToAdd": [{ "matcherName": "Greeting", "phrase": "hey there" }],
  "reasoning": "'hey there' is a greeting but not in the Greeting set — adding via phrasesToAdd."
}`;
}

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
        return this.queryAndParse(`${buildSystemPrompt()}\n\n${prompt}`);
    }

    /**
     * Refine a previously generated grammar rule that failed to match the original request.
     * Gives Claude specific feedback: the failed rule, the tokenized request, and hints.
     */
    async refineGrammar(
        testCase: GrammarTestCase,
        schemaInfo: SchemaInfo,
        failedRule: string,
        requestTokens: string[],
    ): Promise<GrammarAnalysis> {
        const actionInfo = schemaInfo.actions.get(testCase.action.actionName);
        if (!actionInfo) {
            throw new Error(`Action not found: ${testCase.action.actionName}`);
        }
        const basePrompt = this.buildPrompt(testCase, actionInfo, schemaInfo);

        const refinementNote = `
CORRECTION NEEDED — your previous rule did not match the input.

Previous rule that FAILED:
${failedRule}

Request tokens: [${requestTokens.map((t) => `"${t}"`).join(", ")}]

Why it likely failed: the matchPattern contains fixed words that don't appear at any
contiguous position in the token stream, OR the wildcard structure doesn't align with
where the parameter values appear in the tokens.

How to fix it:
1. The matchPattern must cover ALL tokens in the request token list above
2. For leading courtesy words (please, hey, ok, etc.) use (<Polite>)? or (<Greeting>)?
3. For hesitations/fillers (um, uh, ah, aa, like, yeah, you know, etc.) use (<FillerWord>)*
   — use * (zero-or-more) NOT ? (zero-or-one) since multiple fillers can appear in sequence.
   Do NOT define custom rules for hesitations/fillers; always use <FillerWord>.
4. For request-specific filler that doesn't map to a parameter (e.g., "of fugues"),
   define an additionalRule and use it as (<ExtraneousPhrase>)?
5. Make sure wildcards and fixed words align exactly with the token positions

Generate a corrected rule now.`;

        return this.queryAndParse(
            `${buildSystemPrompt()}\n\n${basePrompt}${refinementNote}`,
        );
    }

    private async queryAndParse(fullPrompt: string): Promise<GrammarAnalysis> {
        // Use the Agent SDK query function
        const queryInstance = query({
            prompt: fullPrompt,
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

            // Use getWildcardType to determine the correct type (handles paramSpecs and defaults)
            const wildcardType = paramInfo
                ? getWildcardType(paramInfo)
                : "wildcard";
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

        if (schemaInfo.converters.size > 0) {
            prompt += `\nBuilt-in converters/parsers available:\n`;
            for (const [, converter] of schemaInfo.converters) {
                prompt += `  ${converter.name}:\n`;
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
        prompt += `   - Use the EXACT type from the "→ USE:" directive for each parameter\n`;
        prompt += `   - For array parameters: use SINGULAR variable name\n`;
        prompt += `3. Keep the pattern simple and direct\n`;
        prompt += `4. Adjacent wildcards:\n`;
        prompt += `   - Parameters marked "(validated)" are checked against real data (e.g., Spotify API)\n`;
        prompt += `   - Adjacent wildcards are OK if AT LEAST ONE is validated (parse validated first, then remainder)\n`;
        prompt += `   - Adjacent wildcards with NO validated parameters need a separator or structure\n\n`;

        prompt += `CRITICAL - Type Usage:\n`;
        prompt += `Each parameter above has a "→ USE:" directive showing the exact wildcard pattern.\n`;
        prompt += `- ALWAYS use the type shown in the "→ USE:" directive\n`;
        prompt += `- ALWAYS use the variable name shown in the "→ USE:" directive\n`;
        prompt += `Example:\n`;
        prompt += `  Parameter: deviceName "kitchen" (validated) → USE: $(deviceName:wildcard)\n`;
        prompt += `  Correct pattern: $(deviceName:wildcard)\n`;
        prompt += `  Wrong: $(device:wildcard) or $(deviceName:string)\n\n`;

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
                debug(
                    `Claude included text before JSON: "${preamble.substring(0, 100)}..."`,
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
                debug(
                    `Removed comment/copyright text from Claude response. Original: "${str.substring(0, 100)}..."`,
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
     * Uses the exact action name as the rule name (e.g., <scheduleEvent> = ... ;)
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

        // Replace types in the matchPattern — normalize any type Claude used to the correct one
        let matchPattern = analysis.grammarPattern.matchPattern;
        for (const [varName, wildcardType] of wildcardTypes) {
            // Match $(varName:AnyType) and replace with $(varName:CorrectType)
            const anyTypePattern = new RegExp(`\\$\\(${varName}:\\w+\\)`, "g");
            matchPattern = matchPattern.replace(
                anyTypePattern,
                `$(${varName}:${wildcardType})`,
            );
        }

        // Collect preamble rule definitions.
        // Phrase-set matchers (<Polite>, <Greeting>, etc.) are resolved at match
        // time by the NFA interpreter — they do NOT need inline definitions here.
        // Only rule-specific helper rules (additionalRules) need to be prepended.
        const preambleRules: string[] = [];

        // Inject any rule-specific helper rules Claude defined
        if (analysis.additionalRules) {
            for (const rule of analysis.additionalRules) {
                preambleRules.push(rule.ruleText);
            }
        }

        let grammar =
            preambleRules.length > 0 ? preambleRules.join("\n") + "\n" : "";

        // <Start> rule + action rule
        grammar += `<Start> = <${actionName}>;\n`;
        grammar += `<${actionName}> = `;
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

        grammar += `\n};`;

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
