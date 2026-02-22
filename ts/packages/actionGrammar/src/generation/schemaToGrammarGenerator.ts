// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { query } from "@anthropic-ai/claude-agent-sdk";
import { SchemaInfo, ActionInfo } from "./schemaReader.js";
import { GrammarTestCase } from "./testTypes.js";
import { loadGrammarRulesNoThrow } from "../grammarLoader.js";

/**
 * Configuration for grammar generation from a schema
 */
export interface SchemaGrammarConfig {
    // Number of example requests to generate per common action
    examplesPerAction?: number;
    // Model to use for generation
    model?: string;
    // Whether to include common patterns (like Ordinal, Cardinal)
    includeCommonPatterns?: boolean;
    // Maximum number of retries for fixing grammar errors
    maxRetries?: number;
    // Existing grammar text to extend/improve (optional)
    existingGrammar?: string;
    // Additional instructions for how to improve the grammar and what examples to generate
    improvementInstructions?: string;
}

/**
 * Result of generating grammar from a schema
 */
export interface SchemaGrammarResult {
    // The complete .agr grammar text
    grammarText: string;
    // Actions that were successfully converted
    successfulActions: string[];
    // Actions that were rejected with reasons
    rejectedActions: Map<string, string>;
    // Generated test cases for documentation
    testCases: GrammarTestCase[];
}

const SCHEMA_GRAMMAR_PROMPT = `You are an expert at creating comprehensive Action Grammar (.agr) files for natural language interfaces.

Your task is to analyze a complete action schema and generate an efficient, maintainable grammar that covers all actions with shared sub-rules where appropriate.

The Action Grammar format uses:
- Rule definitions: @ <RuleName> = pattern
- Literal text: "play" or 'play'
- Wildcards with types: $(name:Type) - captures any text and assigns it to 'name' with validation type 'Type'
- Optional elements: element?
- Zero or more: element*
- One or more: element+
- Alternation: pattern1 | pattern2
- Grouping: (expression) - groups expressions for operators
- Rule references: <RuleName>
- Action objects: -> { actionName: "...", parameters: { paramName: varName } }
- Comments: // this is a comment  (NOT # which is invalid)

FULL EXAMPLE showing captures and action body:
  @ <play> = ('play' | 'start') $(track:string) ('by' $(artist:string))? -> { actionName: "play", parameters: { track: track, artist: artist } }
  Note: $(track:string) captures to variable 'track'; in the action body write just 'track' (no $ prefix)

CRITICAL SYNTAX RULES:
1. ALWAYS use parentheses around alternatives when combined with operators
   CORRECT: ('can you'? 'add' | 'include')
   WRONG: 'can you'? 'add' | 'include'

2. ALWAYS use parentheses around groups that should be treated as a unit
   CORRECT: ('on' | 'for') $(date:CalendarDate)
   WRONG: 'on' | 'for' $(date:CalendarDate)

3. Optional groups must have parentheses:
   CORRECT: ('with' $(participant:string))?
   WRONG: 'with' $(participant:string)?

4. Wildcard type annotations CANNOT contain pipes or unions
   For parameters with union types (e.g., CalendarTime | CalendarTimeRange):
   OPTION A: Create a sub-rule with alternation
     @ <TimeSpec> = $(t:CalendarTime) -> t | $(t:CalendarTimeRange) -> t
   OPTION B: Just use one of the types
     @ <TimeExpr> = $(time:CalendarTime)
   WRONG: $(time:CalendarTime | CalendarTimeRange)

5. Action rule names MUST match the exact action name (not capitalized)
   CORRECT: @ <scheduleEvent> = ... for action "scheduleEvent"
   WRONG: @ <ScheduleEvent> = ... for action "scheduleEvent"
   This enables easy targeting of specific actions when extending grammars incrementally.

6. BARE VARIABLE NAMES in action body values — NEVER use $ in the action body:
   CORRECT: @ <send> = 'send' $(msg:string) 'to' $(to:string) -> { actionName: "send", parameters: { message: msg, recipient: to } }
   WRONG:   -> { actionName: "send", parameters: { message: $msg, recipient: $to } }
   WRONG:   -> { actionName: "send", parameters: { message: $(msg), recipient: $(to) } }
   WRONG:   -> { actionName: "send", parameters: { message: $(msg:string) } }
   The capture $(name:Type) defines the variable 'name'; in the action body, reference it as just 'name'.

7. In sub-rule VALUE positions (after ->), ONLY reference vars captured in THAT SAME RULE's pattern:
   CORRECT: @ <DirSpec> = $(d:string) -> d       (d is captured in this rule's pattern)
   CORRECT: @ <TimeSpec> = $(t:CalendarTime) -> t | $(t:CalendarTimeRange) -> t
   WRONG:   @ <DirSpec> = 'vertical' | 'horizontal' -> direction    (no capture, 'direction' is undefined)
   WRONG:   @ <DirSpec> = 'vertical' | 'horizontal' -> $(direction:string)  ($ not allowed in value pos)
   If a sub-rule just matches alternatives ('a' | 'b'), it doesn't produce a value; don't use -> on it.
   When alternatives capture DIFFERENT variables, give EACH alternative its own ->:
   CORRECT: @ <DurationSpec> = $(m:number) ('minute' | 'minutes') -> m | $(s:number) ('second' | 'seconds') -> s
   WRONG:   @ <DurationSpec> = ($(m:number) 'minutes' | $(s:number) 'seconds') -> d  (d undefined!)

8. Variables referenced in the action body MUST be captured DIRECTLY in the same rule (not only in sub-rules):
   CORRECT: @ <sendEmail> = 'send' 'email' 'to' $(to:string) 'about' $(subject:string) -> { actionName: "sendEmail", parameters: { to: to, subject: subject } }
   WRONG (to/subject not captured in sendEmail rule, only in sub-rules):
     @ <sendEmail> = 'send' 'email' <RecipientSpec> <SubjectSpec> -> { actionName: "sendEmail", parameters: { to: to, subject: subject } }
   If you use value-producing sub-rules, capture the sub-rule's OUTPUT with a wildcard in the parent: $(varName:SubRuleName)
   Or inline the pattern directly in the action rule to avoid this.
   CORRECT using sub-rule capture: @ <sendEmail> = 'send' $(to:RecipientSpec) $(subject:SubjectSpec) -> { actionName: "sendEmail", parameters: { to: to, subject: subject } }

9. Comments use // not #:
   CORRECT: // This is a comment
   WRONG:   # This is a comment

10. Hyphenated and apostrophe string literals:
    a) Apostrophes/contractions: "don't" "it's" "let's"  (NOT 'don\'t' or 'it\'s' — use double quotes)
    b) Hyphenated words like 'auto-reload' or "auto-generate" CANNOT appear in any quoted string
       (hyphens are special characters even inside double-quoted strings).
       Instead, split into separate tokens: 'auto' 'reload' or 'auto' 'generate'
       Or simply omit the hyphenated form entirely and match the words separately.
       CORRECT: ('auto' 'generate' | 'autogenerate')?
       WRONG:   'auto-generate' or "auto-generate"  (both cause parse errors!)

11. Action body values must be SIMPLE variable names only — no dot notation, array access, or expressions:
    CORRECT: -> { actionName: "create", parameters: { name: name, language: language } }
    WRONG:   -> { actionName: "create", parameters: { declaration: details.declaration, body: details.body } }
    If a TypeScript schema parameter has nested fields, just capture it as a single string wildcard.
    Grammar rules capture flat key/value pairs; don't model nested object structures.

12. When using a CUSTOM SUB-RULE (not a built-in entity type) as a wildcard type, wrap the rule name in angle brackets:
    CORRECT: $(location:<LocationSpec>)   — rule reference in wildcard (angle brackets required)
    CORRECT: $(days:<DaysSpec>)?          — optional rule-typed capture
    WRONG:   $(location:LocationSpec)     — rule name without angle brackets (will cause "Undefined type" error)
    Built-in types do NOT use angle brackets: $(t:CalendarTime), $(n:number), $(s:string), $(x:wildcard)
    Custom rule names always need angle brackets: $(var:<MyRule>)
    Built-in type names are CASE-SENSITIVE and LOWERCASE:
    CORRECT: $(n:number) $(s:string) $(x:wildcard)
    WRONG:   $(n:Number) $(s:String) $(x:Wildcard)  (capital letters cause "Undefined type" errors)

EFFICIENCY GUIDELINES:
1. Identify common patterns across actions and extract them as sub-rules
   Example: If multiple actions use date expressions, create @ <DateExpr> = ('on' | 'for') $(date:CalendarDate)

2. Create shared vocabulary rules for common phrases
   Example: @ <Polite> = 'can you'? | 'please'? | 'would you'?

3. Reuse entity type rules across actions
   Example: If multiple actions need participant names, reference the same wildcard pattern

4. Keep the grammar maintainable - don't over-optimize at the expense of readability

5. The Start rule should reference all top-level action rules

GRAMMAR STRUCTURE:
1. Start with @ <Start> rule listing all actions by their exact action names
   Example: @ <Start> = <scheduleEvent> | <findEvents> | <addParticipant>
2. Define action rules using EXACT action names as rule names (not capitalized)
   Example: @ <scheduleEvent> = ... for action "scheduleEvent"
   Example: @ <findEvents> = ... for action "findEvents"
3. Define shared sub-rules used by multiple actions (these can be capitalized)
   Example: @ <Polite> = ..., @ <DateSpec> = ...
4. Include common patterns (Cardinal, Ordinal, etc.)

AVAILABLE ENTITY TYPES AND CONVERTERS:
{entityTypes}

COMPLETE SCHEMA:
{schemaInfo}

EXAMPLE REQUESTS FOR COMMON ACTIONS:
{examples}

Generate a complete, syntactically correct .agr grammar file that:
1. Covers all actions in the schema
2. Uses shared sub-rules for common patterns
3. Is efficient and maintainable
4. Follows all syntax rules
5. Includes the Start rule

Response format: Return ONLY the complete .agr file content, starting with copyright header.`;

const SCHEMA_GRAMMAR_EXTENSION_PROMPT = `You are an expert at improving and extending Action Grammar (.agr) files for natural language interfaces.

Your task is to extend/improve an existing grammar based on a schema, new examples, and specific improvement instructions.

EXISTING GRAMMAR:
{existingGrammar}

COMPLETE SCHEMA:
{schemaInfo}

NEW EXAMPLE REQUESTS:
{examples}

IMPROVEMENT INSTRUCTIONS:
{improvementInstructions}

AVAILABLE ENTITY TYPES AND CONVERTERS:
{entityTypes}

Your task:
1. Analyze the existing grammar and identify areas for improvement
2. Incorporate the new examples by extending or refining existing rules
3. Follow the improvement instructions to enhance the grammar
4. Maintain consistency with existing patterns and style
5. Ensure all actions in the schema are covered
6. Keep shared sub-rules and don't duplicate patterns
7. Follow all AGR syntax rules (see above)
8. IMPORTANT: Use exact action names for action rules (e.g., @ <scheduleEvent> = ..., not @ <ScheduleEvent> = ...)
   This enables easy targeting of specific actions when extending grammars incrementally

Response format: Return ONLY the complete improved .agr file content, starting with copyright header.`;

const COMMON_ACTIONS_PROMPT = `You are analyzing an action schema to identify the most commonly used actions.

Given this schema with {actionCount} actions:
{actionList}

Identify the {exampleCount} most common actions that users are likely to request most frequently.

Response format: JSON array of action names, e.g. ["action1", "action2"]`;

const EXAMPLE_GENERATION_PROMPT = `You are an expert at generating natural language examples for action-based interfaces.

Generate {count} diverse, realistic user requests for this action:

Action: {actionName}
Parameters: {parameters}

Requirements:
1. Natural, conversational requests that real users would say
2. Different phrasings and variations (polite, casual, terse)
3. Realistic parameter values
4. Cover different parameter combinations

Response format: JSON array of strings, e.g. ["request 1", "request 2"]`;

export class SchemaToGrammarGenerator {
    private model: string;
    private maxRetries: number;

    constructor(config: SchemaGrammarConfig = {}) {
        this.model = config.model || "claude-sonnet-4-20250514";
        this.maxRetries = config.maxRetries || 3;
    }

    /**
     * Generate a complete .agr grammar from a schema
     */
    async generateGrammar(
        schemaInfo: SchemaInfo,
        config: SchemaGrammarConfig = {},
    ): Promise<SchemaGrammarResult> {
        const examplesPerAction = config.examplesPerAction || 2;

        console.log(
            `\nGenerating grammar for schema: ${schemaInfo.schemaName} (${schemaInfo.actions.size} actions)`,
        );

        // Step 1: Identify most common actions
        console.log(`\nStep 1: Identifying most common actions...`);
        const commonActionCount = Math.min(
            Math.ceil(schemaInfo.actions.size / 2),
            5,
        );
        const commonActions = await this.identifyCommonActions(
            schemaInfo,
            commonActionCount,
        );
        console.log(
            `  Selected ${commonActions.length} common actions: ${commonActions.join(", ")}`,
        );

        // Step 2: Generate examples for common actions
        console.log(
            `\nStep 2: Generating ${examplesPerAction} examples for each common action...`,
        );
        const testCases: GrammarTestCase[] = [];
        const examplesByAction = new Map<string, string[]>();

        for (const actionName of commonActions) {
            const actionInfo = schemaInfo.actions.get(actionName);
            if (!actionInfo) continue;

            console.log(`  Generating examples for ${actionName}...`);
            const examples = await this.generateExamplesForAction(
                actionInfo,
                schemaInfo,
                examplesPerAction,
            );
            examplesByAction.set(actionName, examples);

            // Convert to test cases for result
            for (const example of examples) {
                testCases.push({
                    request: example,
                    schemaName: schemaInfo.schemaName,
                    action: {
                        actionName,
                        parameters: {},
                    },
                });
            }
        }

        // Step 3: Generate complete grammar
        console.log(`\nStep 3: Generating complete grammar...`);
        let grammarText = await this.generateCompleteGrammar(
            schemaInfo,
            examplesByAction,
            config,
        );

        // Step 4: Validate and fix grammar
        console.log(`\nStep 4: Validating grammar...`);
        const validationResult = await this.validateAndFixGrammar(grammarText);

        if (!validationResult.success) {
            return {
                grammarText: "",
                successfulActions: [],
                rejectedActions: new Map([
                    [
                        "schema",
                        validationResult.error ||
                            "Failed to generate valid grammar",
                    ],
                ]),
                testCases,
            };
        }

        console.log(`\n✓ Grammar generation complete`);

        return {
            grammarText: validationResult.grammar!,
            successfulActions: Array.from(schemaInfo.actions.keys()),
            rejectedActions: new Map(),
            testCases,
        };
    }

    /**
     * Identify the most common actions from the schema
     */
    private async identifyCommonActions(
        schemaInfo: SchemaInfo,
        count: number,
    ): Promise<string[]> {
        const actionList = Array.from(schemaInfo.actions.keys())
            .map((name) => `- ${name}`)
            .join("\n");

        const prompt = COMMON_ACTIONS_PROMPT.replace(
            "{actionCount}",
            String(schemaInfo.actions.size),
        )
            .replace("{actionList}", actionList)
            .replace("{exampleCount}", String(count));

        const queryInstance = query({
            prompt,
            options: {
                model: this.model,
            },
        });

        let responseText = "";
        for await (const message of queryInstance) {
            if (message.type === "result") {
                if (message.subtype === "success") {
                    responseText = message.result || "";
                    break;
                }
            }
        }

        const jsonMatch = responseText.match(/\[[\s\S]*?\]/);
        if (!jsonMatch) {
            // Fallback: return first N actions
            return Array.from(schemaInfo.actions.keys()).slice(0, count);
        }

        try {
            return JSON.parse(jsonMatch[0]);
        } catch {
            return Array.from(schemaInfo.actions.keys()).slice(0, count);
        }
    }

    /**
     * Generate example requests for a single action
     */
    private async generateExamplesForAction(
        actionInfo: ActionInfo,
        schemaInfo: SchemaInfo,
        count: number,
    ): Promise<string[]> {
        const parameters = Array.from(actionInfo.parameters.entries())
            .map(([name, info]) => {
                let desc = `${name}`;
                if (info.isEntityType && info.entityTypeName) {
                    desc += ` (${info.entityTypeName})`;
                }
                return desc;
            })
            .join(", ");

        const prompt = EXAMPLE_GENERATION_PROMPT.replace(
            "{count}",
            String(count),
        )
            .replace("{actionName}", actionInfo.actionName)
            .replace("{parameters}", parameters);

        const queryInstance = query({
            prompt,
            options: {
                model: this.model,
            },
        });

        let responseText = "";
        for await (const message of queryInstance) {
            if (message.type === "result") {
                if (message.subtype === "success") {
                    responseText = message.result || "";
                    break;
                }
            }
        }

        const jsonMatch = responseText.match(/\[[\s\S]*?\]/);
        if (!jsonMatch) {
            // Non-fatal: return empty so grammar generation can still proceed
            console.warn(
                `  Warning: no examples generated for action (will proceed without)`,
            );
            return [];
        }

        try {
            return JSON.parse(jsonMatch[0]);
        } catch {
            return [];
        }
    }

    /**
     * Generate the complete grammar from schema and examples
     */
    private async generateCompleteGrammar(
        schemaInfo: SchemaInfo,
        examplesByAction: Map<string, string[]>,
        config: SchemaGrammarConfig = {},
    ): Promise<string> {
        const schemaDescription = this.formatSchemaForPrompt(schemaInfo);
        const examplesDescription =
            this.formatExamplesForPrompt(examplesByAction);
        const entityTypes = this.formatEntityTypes(schemaInfo);

        // Choose prompt based on whether we're extending an existing grammar
        let prompt: string;
        if (config.existingGrammar) {
            // Extension mode
            prompt = SCHEMA_GRAMMAR_EXTENSION_PROMPT.replace(
                "{existingGrammar}",
                config.existingGrammar,
            )
                .replace("{schemaInfo}", schemaDescription)
                .replace("{examples}", examplesDescription)
                .replace(
                    "{improvementInstructions}",
                    config.improvementInstructions ||
                        "No specific instructions",
                )
                .replace("{entityTypes}", entityTypes);
        } else {
            // New grammar mode
            prompt = SCHEMA_GRAMMAR_PROMPT.replace("{entityTypes}", entityTypes)
                .replace("{schemaInfo}", schemaDescription)
                .replace("{examples}", examplesDescription);
        }

        const queryInstance = query({
            prompt,
            options: {
                model: this.model,
            },
        });

        let responseText = "";
        for await (const message of queryInstance) {
            if (message.type === "result") {
                if (message.subtype === "success") {
                    responseText = message.result || "";
                    break;
                }
            }
        }

        // Extract grammar text (might be wrapped in markdown code blocks)
        let grammar = responseText;
        const codeBlockMatch = responseText.match(
            /```(?:agr)?\n([\s\S]*?)\n```/,
        );
        if (codeBlockMatch) {
            grammar = codeBlockMatch[1];
        }

        return grammar.trim();
    }

    /**
     * Normalize common LLM mistakes in grammar text before compilation.
     * Fixes capitalized built-in type names inside wildcard captures.
     */
    private normalizeGrammar(grammar: string): string {
        // $(name:Number) -> $(name:number), $(name:String) -> $(name:string), etc.
        return grammar.replace(
            /\$\(([A-Za-z_][A-Za-z0-9_]*):(Number|String|Wildcard)\)/g,
            (_, name, type) => `$(${name}:${type.toLowerCase()})`,
        );
    }

    /**
     * Validate grammar and attempt fixes if needed
     */
    private async validateAndFixGrammar(
        grammarText: string,
    ): Promise<{ success: boolean; grammar?: string; error?: string }> {
        let currentGrammar = grammarText;
        let retries = 0;

        while (retries <= this.maxRetries) {
            currentGrammar = this.normalizeGrammar(currentGrammar);
            const errors: string[] = [];
            loadGrammarRulesNoThrow("generated.agr", currentGrammar, errors);

            if (errors.length === 0) {
                if (retries > 0) {
                    console.log(
                        `  ✓ Grammar fixed after ${retries} attempt(s)`,
                    );
                } else {
                    console.log(`  ✓ Grammar is valid`);
                }
                return { success: true, grammar: currentGrammar };
            }

            if (retries >= this.maxRetries) {
                return {
                    success: false,
                    error: `Grammar validation failed after ${this.maxRetries} retries: ${errors.join("; ")}`,
                };
            }

            console.log(
                `  Validation errors detected, attempting fix (${retries + 1}/${this.maxRetries})...`,
            );
            console.log(
                `  Errors: ${errors.slice(0, 3).join("; ")}${errors.length > 3 ? "..." : ""}`,
            );

            // Attempt to fix
            const fixedGrammar = await this.fixGrammar(currentGrammar, errors);
            if (!fixedGrammar) {
                return {
                    success: false,
                    error: `Failed to fix grammar: ${errors.join("; ")}`,
                };
            }

            currentGrammar = fixedGrammar;
            retries++;
        }

        return {
            success: false,
            error: "Unexpected state in validation loop",
        };
    }

    /**
     * Ask Claude to fix grammar errors
     */
    private async fixGrammar(
        grammarText: string,
        errors: string[],
    ): Promise<string | null> {
        const prompt = `You are an expert at fixing Action Grammar (.agr) syntax errors.

The grammar compiler has detected syntax errors. Please fix them and return the corrected grammar.

COMPILATION ERRORS:
${errors.join("\n")}

ORIGINAL GRAMMAR:
${grammarText}

Remember the CRITICAL SYNTAX RULES:
1. ALWAYS use parentheses around alternatives when combined with operators
2. ALWAYS use parentheses around groups that should be treated as a unit
3. Optional groups must have parentheses
4. BARE VARIABLE NAMES in action body values — NEVER use $ or $() in the action body:
   CORRECT: -> { actionName: "send", parameters: { message: msg, recipient: to } }
   WRONG:   -> { actionName: "send", parameters: { message: $msg, recipient: $to } }
   WRONG:   -> { actionName: "send", parameters: { message: $(msg:string) } }
   The capture $(name:Type) defines variable 'name'; reference it in action body as just 'name'.
5. In sub-rule VALUE positions (after ->), ONLY reference vars captured in THAT SAME RULE's pattern:
   CORRECT: @ <DirSpec> = $(d:string) -> d       (d was captured in this rule)
   WRONG:   @ <DirSpec> = 'vertical' | 'horizontal' -> direction  (no capture, undefined)
   WRONG:   @ <DirSpec> = 'vertical' | 'horizontal' -> $(direction:string)  ($ not allowed in values)
6. Variables in action body must be captured DIRECTLY in the same rule — inline patterns or use $(var:SubRule):
   CORRECT: @ <sendEmail> = 'send' 'email' 'to' $(to:string) 'about' $(subject:string) -> { actionName: "sendEmail", parameters: { to: to, subject: subject } }
   WRONG (to/subject only in sub-rules): @ <sendEmail> = 'send' <RecipientSpec> <SubjectSpec> -> { actionName: "sendEmail", parameters: { to: to, subject: subject } }
   CORRECT using sub-rule capture: @ <sendEmail> = 'send' $(to:RecipientSpec) $(subject:SubjectSpec) -> { actionName: "sendEmail", parameters: { to: to, subject: subject } }
7. Comments use // not #.
8. String literal quoting:
   a) Apostrophes/contractions must use double quotes: "don't" "it's"  (NOT 'don\'t')
   b) Hyphens CANNOT appear in any quoted string — not even double quotes! Split instead:
      WRONG: 'auto-reload' or "auto-reload"  (BOTH fail with "Special character" error)
      CORRECT: 'auto' 'reload'  (separate tokens)
9. In sub-rule VALUE positions: when alternatives capture DIFFERENT variables, give each its own ->:
   CORRECT: @ <DurationSpec> = $(m:number) ('minute' | 'minutes') -> m | $(s:number) ('second' | 'seconds') -> s
   WRONG:   @ <DurationSpec> = ($(m:number) 'minutes' | $(s:number) 'seconds') -> d  (d is undefined!)
10. Custom sub-rule names as wildcard types need angle brackets: $(var:<MyRule>) not $(var:MyRule).
    Only built-in types skip angle brackets: string, number, wildcard, CalendarDate, CalendarTime, etc.
    Built-in type names are CASE-SENSITIVE and LOWERCASE:
    CORRECT: $(n:number) $(s:string) $(x:wildcard)
    WRONG:   $(n:Number) $(s:String) — capital letters cause "Undefined type" errors
11. Action body values must be SIMPLE variable names only — no dot notation:
    CORRECT: { name: name, language: language }
    WRONG:   { declaration: details.declaration }  (dot notation not valid)
    Capture each parameter as its own $(var:type) wildcard.

Return the complete corrected grammar, starting with the copyright header.`;

        const queryInstance = query({
            prompt,
            options: {
                model: this.model,
            },
        });

        let responseText = "";
        for await (const message of queryInstance) {
            if (message.type === "result") {
                if (message.subtype === "success") {
                    responseText = message.result || "";
                    break;
                } else {
                    return null;
                }
            }
        }

        // Extract grammar
        let grammar = responseText;
        const codeBlockMatch = responseText.match(
            /```(?:agr)?\n([\s\S]*?)\n```/,
        );
        if (codeBlockMatch) {
            grammar = codeBlockMatch[1];
        }

        return grammar.trim() || null;
    }

    private formatSchemaForPrompt(schemaInfo: SchemaInfo): string {
        let result = `Schema Name: ${schemaInfo.schemaName}\n\n`;
        result += `Actions (${schemaInfo.actions.size}):\n`;

        for (const [actionName, actionInfo] of schemaInfo.actions) {
            result += `\n- ${actionName}\n`;
            if (actionInfo.parameters.size > 0) {
                result += `  Parameters:\n`;
                for (const [paramName, paramInfo] of actionInfo.parameters) {
                    result += `    - ${paramName}`;
                    if (paramInfo.isEntityType && paramInfo.entityTypeName) {
                        result += ` (type: ${paramInfo.entityTypeName})`;
                    } else {
                        result += ` (type: string)`;
                    }
                    if (paramInfo.paramSpec) {
                        result += ` - ${paramInfo.paramSpec}`;
                    }
                    result += "\n";
                }
            } else {
                result += `  No parameters\n`;
            }
        }

        return result;
    }

    private formatExamplesForPrompt(
        examplesByAction: Map<string, string[]>,
    ): string {
        if (examplesByAction.size === 0) {
            return "No examples provided.";
        }

        let result = "";
        for (const [actionName, examples] of examplesByAction) {
            result += `\n${actionName}:\n`;
            for (const example of examples) {
                result += `  - "${example}"\n`;
            }
        }

        return result;
    }

    private formatEntityTypes(schemaInfo: SchemaInfo): string {
        const types: string[] = [];

        if (schemaInfo.entityTypes.size > 0) {
            types.push(
                `Entity Types: ${Array.from(schemaInfo.entityTypes).join(", ")}`,
            );
        }

        if (schemaInfo.converters.size > 0) {
            types.push(
                `Converters: ${Array.from(schemaInfo.converters.keys()).join(", ")}`,
            );
        }

        return types.length > 0 ? types.join("\n") : "None";
    }
}
