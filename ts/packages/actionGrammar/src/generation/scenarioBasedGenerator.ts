// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { query } from "@anthropic-ai/claude-agent-sdk";
import { SchemaInfo, ActionInfo, getWildcardType } from "./schemaReader.js";
import {
    ScenarioTemplate,
    getPrefixSuffixPatterns,
} from "./scenarioTemplates.js";
import { loadGrammarRulesNoThrow } from "../grammarLoader.js";

/**
 * Configuration for scenario-based grammar generation
 */
export interface ScenarioGrammarConfig {
    /** Scenarios to use for pattern generation */
    scenarios: ScenarioTemplate[];
    /** Number of patterns to generate per (action × scenario) combination */
    patternsPerScenario?: number;
    /** Ratio of French patterns to English (e.g., 0.1 for 10% French) */
    frenchRatio?: number;
    /** Include prefix/suffix patterns in output */
    includePrefixSuffixPatterns?: boolean;
    /** Existing grammar to extend (optional) */
    existingGrammar?: string;
}

/**
 * Constructor configuration for ScenarioBasedGrammarGenerator
 */
export interface ScenarioGeneratorOptions {
    /** Model to use for generation */
    model?: string;
    /** Maximum retries for grammar validation/fixing */
    maxRetries?: number;
}

/**
 * Result of scenario-based grammar generation
 */
export interface ScenarioGrammarResult {
    /** Complete .agr grammar text */
    grammarText: string;
    /** Number of patterns generated per action */
    patternsPerAction: Map<string, number>;
    /** Patterns rejected due to adjacent wildcard rules */
    rejectedPatterns: string[];
    /** Generation statistics */
    stats: {
        totalPatterns: number;
        englishPatterns: number;
        frenchPatterns: number;
        rejectedCount: number;
    };
}

const SCENARIO_PATTERN_GENERATION_PROMPT = `You are generating natural language patterns for a voice assistant based on realistic user scenarios.

SCENARIO CONTEXT:
Scenario: {scenarioName}
Description: {scenarioDescription}
User situation: {situation}
Physical state: {physicalState}
Emotional state: {emotionalState}
Formality: {formality}
Domain vocabulary: {vocabulary}
User goals: {goals}

ACTION INFORMATION:
Action: {actionName}
Parameters: {parameters}

TASK:
Generate {count} natural {language} phrases that a user in this scenario would say to perform this action.

REQUIREMENTS:
1. Use language appropriate to the scenario context and formality level
2. Consider user's physical/emotional state:
   - If hands-free or multitasking: brief, direct phrases
   - If urgent: terse, imperative forms
   - If relaxed: more varied, possibly longer phrases
   - If formal: polite prefixes and complete sentences
3. Incorporate domain vocabulary where natural
4. Maintain all required parameters as wildcards: $(paramName:typeName)
   - Use "wildcard" type for multi-word captures (names, descriptions, phrases)
   - Use "word" type for single-word captures (day names, single tokens)
5. Vary sentence structure (imperative, question, statement)
6. DO NOT include polite prefixes/suffixes as part of the pattern if they can be separated
   - GOOD: "play $(trackName:wildcard)" (can add polite prefix separately)
   - AVOID: "can you play $(trackName:wildcard)" (polite prefix should be optional)
7. For {language}:
   {languageInstructions}

CRITICAL - WILDCARD ADJACENCY RULE:
8. NEVER create patterns with adjacent unchecked wildcards (wildcards with no fixed text between them)
   - Parameters marked "(validated)" are checked wildcards
   - REJECT: "add $(item:wildcard) $(listName:wildcard)" - two unchecked wildcards adjacent
   - ACCEPT: "add $(item:wildcard) to $(listName:wildcard)" - "to" separates them
   - ACCEPT: "play $(trackName:wildcard) $(artist:wildcard)" if BOTH are validated
   - If you cannot separate wildcards with fixed text AND they're not both validated, SKIP that pattern

OUTPUT FORMAT:
Return ONLY a JSON array of pattern strings, one per line:
["pattern1", "pattern2", "pattern3"]

Do NOT include markdown, explanations, or any other text.`;

const LANGUAGE_INSTRUCTIONS = {
    en: `- Use natural English word order (SVO)
- Include contractions where appropriate for formality level (wanna, gotta, etc.)
- Vary between imperative ("play music"), questions ("can you play music"), and statements ("I want to play music")`,
    fr: `- Use natural French word order
- Include appropriate formal/informal forms (tu vs vous based on formality)
- Use French contractions and elisions where natural (je → j', de → d', etc.)
- Vary sentence structure appropriate to French grammar`,
};

/**
 * Scenario-based grammar generator
 *
 * Generates comprehensive grammar patterns by simulating realistic user scenarios
 * rather than just syntactic variations. This produces patterns that users would
 * actually say in context.
 */
export class ScenarioBasedGrammarGenerator {
    private model: string;
    private maxRetries: number;

    constructor(config: ScenarioGeneratorOptions = {}) {
        this.model = config.model || "claude-sonnet-4-20250514";
        this.maxRetries = config.maxRetries || 3;
    }

    /**
     * Generate comprehensive grammar from schema using scenarios
     */
    async generateGrammar(
        schemaInfo: SchemaInfo,
        config: ScenarioGrammarConfig,
    ): Promise<ScenarioGrammarResult> {
        const patternsPerScenario = config.patternsPerScenario || 20;
        const frenchRatio = config.frenchRatio || 0.1;
        const scenarios = config.scenarios || [];

        console.log(
            `\nGenerating scenario-based grammar for: ${schemaInfo.schemaName}`,
        );
        console.log(`  Actions: ${schemaInfo.actions.size}`);
        console.log(`  Scenarios: ${scenarios.length}`);
        console.log(
            `  Target: ${patternsPerScenario} patterns per (action × scenario)`,
        );

        const patternsPerAction = new Map<string, number>();
        const rejectedPatterns: string[] = [];
        const allPatterns = new Map<string, Set<string>>(); // action -> patterns
        let totalEnglish = 0;
        let totalFrench = 0;

        // Generate patterns for each action
        for (const [actionName, actionInfo] of schemaInfo.actions) {
            console.log(`\n  Generating patterns for ${actionName}...`);
            const actionPatterns = new Set<string>();

            // Generate from each scenario
            for (const scenario of scenarios) {
                console.log(
                    `    Scenario: ${scenario.name} (${scenario.language})`,
                );

                // Determine how many patterns to generate for this scenario
                let count = patternsPerScenario;
                if (scenario.language === "fr") {
                    // French gets fewer patterns based on ratio
                    count = Math.max(
                        1,
                        Math.floor(patternsPerScenario * frenchRatio),
                    );
                }

                try {
                    const patterns = await this.generatePatternsForScenario(
                        actionInfo,
                        scenario,
                        count,
                        schemaInfo,
                    );

                    // Validate patterns (check for adjacent wildcards)
                    for (const pattern of patterns) {
                        if (
                            this.validatePattern(
                                pattern,
                                actionInfo,
                                schemaInfo,
                            )
                        ) {
                            actionPatterns.add(pattern);
                            if (scenario.language === "fr") {
                                totalFrench++;
                            } else {
                                totalEnglish++;
                            }
                        } else {
                            rejectedPatterns.push(
                                `${actionName}: ${pattern} (adjacent unchecked wildcards)`,
                            );
                        }
                    }

                    console.log(
                        `      Generated ${patterns.length} patterns, ${actionPatterns.size} unique so far`,
                    );
                } catch (error) {
                    console.error(
                        `      Error generating patterns: ${error instanceof Error ? error.message : String(error)}`,
                    );
                }
            }

            allPatterns.set(actionName, actionPatterns);
            patternsPerAction.set(actionName, actionPatterns.size);
            console.log(
                `    Total patterns for ${actionName}: ${actionPatterns.size}`,
            );
        }

        // Build complete grammar
        console.log(`\n  Building complete grammar...`);
        const grammarText = this.buildGrammarFile(
            schemaInfo,
            allPatterns,
            config,
        );

        // Validate and fix grammar
        console.log(`\n  Validating grammar...`);
        const validationResult = await this.validateAndFixGrammar(grammarText);

        if (!validationResult.success) {
            throw new Error(
                `Grammar validation failed: ${validationResult.error}`,
            );
        }

        console.log(`\n✓ Scenario-based grammar generation complete`);
        console.log(`  English patterns: ${totalEnglish}`);
        console.log(`  French patterns: ${totalFrench}`);
        console.log(`  Rejected patterns: ${rejectedPatterns.length}`);

        return {
            grammarText: validationResult.grammar!,
            patternsPerAction,
            rejectedPatterns,
            stats: {
                totalPatterns: totalEnglish + totalFrench,
                englishPatterns: totalEnglish,
                frenchPatterns: totalFrench,
                rejectedCount: rejectedPatterns.length,
            },
        };
    }

    /**
     * Generate patterns for a single action in a specific scenario
     */
    private async generatePatternsForScenario(
        actionInfo: ActionInfo,
        scenario: ScenarioTemplate,
        count: number,
        schemaInfo: SchemaInfo,
    ): Promise<string[]> {
        // Build parameters description with validation info
        const parametersDesc: string[] = [];
        for (const [paramName, paramInfo] of actionInfo.parameters) {
            const wildcardType = getWildcardType(paramInfo);
            const isValidated = paramInfo.paramSpec === "checked_wildcard";
            let desc = `  - ${paramName}: $(${paramName}:${wildcardType})`;
            if (isValidated) {
                desc += " (validated)";
            }
            parametersDesc.push(desc);
        }

        const languageInstructions = LANGUAGE_INSTRUCTIONS[scenario.language];

        const prompt = SCENARIO_PATTERN_GENERATION_PROMPT.replace(
            "{scenarioName}",
            scenario.name,
        )
            .replace("{scenarioDescription}", scenario.description)
            .replace("{situation}", scenario.userContext.situation)
            .replace("{physicalState}", scenario.userContext.physicalState)
            .replace("{emotionalState}", scenario.userContext.emotionalState)
            .replace("{formality}", scenario.userContext.formality)
            .replace("{vocabulary}", scenario.vocabulary.join(", "))
            .replace("{goals}", scenario.exampleGoals.join("; "))
            .replace("{actionName}", actionInfo.actionName)
            .replace("{parameters}", parametersDesc.join("\n"))
            .replace("{count}", String(count))
            .replace(
                "{language}",
                scenario.language === "fr" ? "French" : "English",
            )
            .replace("{languageInstructions}", languageInstructions);

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

        // Parse JSON array
        const jsonMatch = responseText.match(/\[[\s\S]*?\]/);
        if (!jsonMatch) {
            console.warn(`No JSON array in response, using empty array`);
            return [];
        }

        try {
            return JSON.parse(jsonMatch[0]);
        } catch (error) {
            console.warn(`Failed to parse JSON: ${error}`);
            return [];
        }
    }

    /**
     * Validate a pattern against the adjacent wildcard rule
     *
     * Returns false if the pattern has two adjacent unchecked wildcards with no fixed text between them
     */
    private validatePattern(
        pattern: string,
        actionInfo: ActionInfo,
        _schemaInfo: SchemaInfo,
    ): boolean {
        // Extract all wildcards from pattern: $(paramName:type)
        const wildcardRegex = /\$\(([^:]+):[^)]+\)/g;
        const matches = Array.from(pattern.matchAll(wildcardRegex));

        if (matches.length < 2) {
            // Can't have adjacent wildcards with fewer than 2 wildcards
            return true;
        }

        // Check each pair of consecutive wildcards
        for (let i = 0; i < matches.length - 1; i++) {
            const wildcard1 = matches[i];
            const wildcard2 = matches[i + 1];

            // Get the text between wildcards
            const end1 = (wildcard1.index || 0) + wildcard1[0].length;
            const start2 = wildcard2.index || 0;
            const between = pattern.substring(end1, start2).trim();

            // If there's no fixed text between them, check if both are validated
            if (between.length === 0) {
                const param1Name = wildcard1[1];
                const param2Name = wildcard2[1];

                const param1Info = actionInfo.parameters.get(param1Name);
                const param2Info = actionInfo.parameters.get(param2Name);

                const param1Validated =
                    param1Info?.paramSpec === "checked_wildcard" ||
                    param1Info?.isEntityType;
                const param2Validated =
                    param2Info?.paramSpec === "checked_wildcard" ||
                    param2Info?.isEntityType;

                // Reject if NEITHER is validated
                if (!param1Validated && !param2Validated) {
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * Extract verb phrase and structure from a pattern
     * Returns { verbPhrase, structure } where structure has wildcards replaced with placeholders
     */
    private extractPatternStructure(pattern: string): {
        verbPhrase: string;
        structure: string;
    } {
        // Find the first wildcard
        const wildcardMatch = pattern.match(/\$\([^)]+\)/);
        if (!wildcardMatch) {
            // No wildcards - the whole thing is the verb phrase
            return { verbPhrase: pattern.trim(), structure: pattern };
        }

        const firstWildcardIndex = wildcardMatch.index!;
        const verbPhrase = pattern.substring(0, firstWildcardIndex).trim();

        // Get structure: everything from first wildcard onwards with wildcards replaced by PARAM
        const paramsPart = pattern.substring(firstWildcardIndex);
        const structure = paramsPart.replace(/\$\([^)]+\)/g, "PARAM");

        return { verbPhrase, structure };
    }

    /**
     * Group patterns by their parameter structure and extract verb phrases
     */
    private factorizeVerbPhrases(
        actionName: string,
        patterns: Set<string>,
    ): Map<string, { verbPhrases: string[]; examplePattern: string }> {
        // Map from structure -> { verb phrases, example pattern }
        const structureToVerbs = new Map<
            string,
            { verbs: Set<string>; examplePattern: string }
        >();

        for (const pattern of patterns) {
            const { verbPhrase, structure } =
                this.extractPatternStructure(pattern);

            if (!structureToVerbs.has(structure)) {
                structureToVerbs.set(structure, {
                    verbs: new Set(),
                    examplePattern: pattern,
                });
            }
            structureToVerbs.get(structure)!.verbs.add(verbPhrase);
        }

        // Convert to final format
        const result = new Map<
            string,
            { verbPhrases: string[]; examplePattern: string }
        >();
        for (const [structure, data] of structureToVerbs) {
            result.set(structure, {
                verbPhrases: Array.from(data.verbs).sort(),
                examplePattern: data.examplePattern,
            });
        }

        return result;
    }

    /**
     * Analyze all patterns across actions to identify common verb categories
     * that can be shared across multiple actions
     */
    private identifyCommonVerbCategories(
        allPatterns: Map<string, Set<string>>,
    ): Map<string, { verbs: Set<string>; actions: Set<string> }> {
        // Build verb → actions map
        const verbToActions = new Map<string, Set<string>>();

        for (const [actionName, patterns] of allPatterns) {
            for (const pattern of patterns) {
                const { verbPhrase } = this.extractPatternStructure(pattern);
                // Normalize verb phrase (lowercase, trim)
                const normalizedVerb = verbPhrase.toLowerCase().trim();

                if (!verbToActions.has(normalizedVerb)) {
                    verbToActions.set(normalizedVerb, new Set());
                }
                verbToActions.get(normalizedVerb)!.add(actionName);
            }
        }

        // Group verbs into semantic categories
        // Only keep verbs used by 2+ actions
        const categories = new Map<
            string,
            { verbs: Set<string>; actions: Set<string> }
        >();

        for (const [verb, actions] of verbToActions) {
            if (actions.size >= 2) {
                // Group similar verbs into semantic categories
                const category = this.getVerbCategory(verb);
                if (category) {
                    if (!categories.has(category)) {
                        categories.set(category, {
                            verbs: new Set(),
                            actions: new Set(),
                        });
                    }
                    categories.get(category)!.verbs.add(verb);
                    actions.forEach((a) =>
                        categories.get(category)!.actions.add(a),
                    );
                }
            }
        }

        return categories;
    }

    /**
     * Map a verb to its semantic category for sharing across actions
     * Returns null if the verb shouldn't be shared
     */
    private getVerbCategory(verb: string): string | null {
        const lower = verb.toLowerCase().trim();

        // Add/Create category
        if (
            [
                "add",
                "create",
                "make",
                "setup",
                "set up",
                "insert",
                "schedule",
                "plan",
            ].some((v) => lower.includes(v))
        ) {
            return "CommonVerbs_Add_EN";
        }

        // Show/Display category
        if (
            [
                "show",
                "display",
                "list",
                "get",
                "find",
                "search",
                "look for",
                "check",
            ].some((v) => lower.includes(v))
        ) {
            return "CommonVerbs_Show_EN";
        }

        // Remove/Delete category
        if (
            ["remove", "delete", "clear", "erase", "take away", "cancel"].some(
                (v) => lower.includes(v),
            )
        ) {
            return "CommonVerbs_Delete_EN";
        }

        // Update/Change category
        if (
            ["update", "change", "modify", "edit", "revise", "adjust"].some(
                (v) => lower.includes(v),
            )
        ) {
            return "CommonVerbs_Update_EN";
        }

        // Not a common verb category
        return null;
    }

    /**
     * Generate shared verb category rules that can be used across multiple actions
     */
    private generateSharedVerbCategoryRules(
        categories: Map<string, { verbs: Set<string>; actions: Set<string> }>,
    ): string {
        if (categories.size === 0) {
            return "";
        }

        let output = `// Shared verb categories (used by multiple actions)\n`;

        for (const [categoryName, info] of categories) {
            const verbsList = Array.from(info.verbs).sort();
            if (verbsList.length > 0) {
                output += `@ <${categoryName}> =\n`;
                verbsList.forEach((verb, index) => {
                    const separator = index < verbsList.length - 1 ? " |" : "";
                    // Escape backslashes first, then single quotes in verb phrases
                    const escapedVerb = verb
                        .replace(/\\/g, "\\\\")
                        .replace(/'/g, "\\'");
                    output += `    '${escapedVerb}'${separator}\n`;
                });
                output += `\n`;
            }
        }

        return output;
    }

    /**
     * Build complete .agr grammar file from generated patterns
     */
    private buildGrammarFile(
        schemaInfo: SchemaInfo,
        allPatterns: Map<string, Set<string>>,
        config: ScenarioGrammarConfig,
    ): string {
        let output = `// Copyright (c) Microsoft Corporation.\n`;
        output += `// Licensed under the MIT License.\n\n`;
        output += `// Generated comprehensive grammar - ${new Date().toISOString()}\n`;
        output += `// Schema: ${schemaInfo.schemaName}\n`;
        output += `// Generated using scenario-based approach\n`;
        output += `// Total actions: ${allPatterns.size}\n`;

        const totalPatterns = Array.from(allPatterns.values()).reduce(
            (sum, patterns) => sum + patterns.size,
            0,
        );
        output += `// Total patterns: ${totalPatterns}\n\n`;

        // Add prefix/suffix patterns if requested
        if (config.includePrefixSuffixPatterns !== false) {
            output += `// Common prefix/suffix patterns\n`;
            output += this.generatePrefixSuffixRules();
            output += `\n`;
        }

        // Identify and generate shared verb categories
        const sharedVerbCategories =
            this.identifyCommonVerbCategories(allPatterns);
        if (sharedVerbCategories.size > 0) {
            output +=
                this.generateSharedVerbCategoryRules(sharedVerbCategories);
            output += `\n`;
        }

        // Generate action rules with verb phrase factorization
        for (const [actionName, patterns] of allPatterns) {
            const actionInfo = schemaInfo.actions.get(actionName);
            if (!actionInfo) continue;

            output += `// ${actionName} - ${patterns.size} patterns\n`;

            // Factorize verb phrases
            const structureToVerbs = this.factorizeVerbPhrases(
                actionName,
                patterns,
            );

            // If we have multiple verb phrases for any structure, create verb phrase rules
            let structureIndex = 0;
            const structureRules = new Map<string, string>();

            for (const [structure, data] of structureToVerbs) {
                if (data.verbPhrases.length > 1) {
                    // Check if these verbs belong to a shared category
                    const firstVerb = data.verbPhrases[0].toLowerCase().trim();
                    const sharedCategory = this.getVerbCategory(firstVerb);

                    // If this is a shared category used by this action, reference it
                    if (
                        sharedCategory &&
                        sharedVerbCategories.has(sharedCategory)
                    ) {
                        const categoryInfo =
                            sharedVerbCategories.get(sharedCategory)!;
                        // Check if most of the verbs in this structure are in the shared category
                        const sharedVerbs = data.verbPhrases.filter((v) =>
                            categoryInfo.verbs.has(v.toLowerCase().trim()),
                        );
                        if (
                            sharedVerbs.length >=
                            data.verbPhrases.length * 0.7
                        ) {
                            // 70% threshold
                            // Use the shared category instead of creating action-specific rule
                            structureRules.set(structure, sharedCategory);
                            continue; // Skip creating action-specific rule
                        }
                    }

                    // Create action-specific verb phrase rule (not shared)
                    const ruleName = `${actionName}_Verb${structureIndex}`;
                    structureRules.set(structure, ruleName);

                    output += `@ <${ruleName}> =\n`;
                    data.verbPhrases.forEach((verb, index) => {
                        const escapedVerb = this.escapePatternHyphens(verb);
                        const separator =
                            index < data.verbPhrases.length - 1 ? " |" : "";
                        // Use quotes for multi-word phrases or phrases with special chars
                        const needsQuotes =
                            verb.includes(" ") || verb !== escapedVerb;
                        if (needsQuotes) {
                            output += `    '${escapedVerb}'${separator}\n`;
                        } else {
                            output += `    ${escapedVerb}${separator}\n`;
                        }
                    });
                    output += `\n`;

                    structureIndex++;
                }
            }

            // Now generate the action rule
            output += `@ <${actionName}> =\n`;

            const structureArray = Array.from(structureToVerbs.entries());
            structureArray.forEach(([structure, data], index) => {
                let pattern: string;

                if (structureRules.has(structure)) {
                    // Use the verb phrase rule
                    const verbRuleName = structureRules.get(structure)!;
                    // Extract the parameter part from the example pattern
                    const { verbPhrase } = this.extractPatternStructure(
                        data.examplePattern,
                    );
                    const paramsPart = data.examplePattern
                        .substring(verbPhrase.length)
                        .trim();
                    pattern = `<${verbRuleName}> ${paramsPart}`;
                } else {
                    // Single verb phrase - use the example pattern directly
                    pattern = data.examplePattern;
                }

                const escapedPattern = this.escapePatternHyphens(pattern);
                const ruleWithAction = this.buildRuleWithAction(
                    escapedPattern,
                    actionInfo,
                    schemaInfo,
                );

                const separator = index < structureArray.length - 1 ? " |" : "";
                output += `    ${ruleWithAction}${separator}\n`;
            });

            output += `\n`;
        }

        // Add <ActionStart> rule (all action alternatives)
        output += `@ <ActionStart> =\n`;
        const actionNames = Array.from(allPatterns.keys());
        actionNames.forEach((name, index) => {
            const separator = index < actionNames.length - 1 ? " |" : "";
            output += `    <${name}>${separator}\n`;
        });
        output += `\n`;

        // Add combined prefix rules for each language
        output += `// Combined prefix categories\n`;
        output += `@ <Prefix_EN> =\n`;
        output += `    <PolitePrefix_EN> |\n`;
        output += `    <DesirePrefix_EN> |\n`;
        output += `    <ActionInitiator_EN> |\n`;
        output += `    <Greeting_EN>\n`;
        output += `\n`;

        output += `@ <Prefix_FR> =\n`;
        output += `    <PolitePrefix_FR> |\n`;
        output += `    <DesirePrefix_FR> |\n`;
        output += `    <ActionInitiator_FR> |\n`;
        output += `    <Greeting_FR>\n`;
        output += `\n`;

        // Add combined suffix rules for each language
        output += `// Combined suffix categories\n`;
        output += `@ <Suffix_EN> =\n`;
        output += `    <PoliteSuffix_EN> |\n`;
        output += `    <Acknowledgement_EN>\n`;
        output += `\n`;

        output += `@ <Suffix_FR> =\n`;
        output += `    <PoliteSuffix_FR> |\n`;
        output += `    <Acknowledgement_FR>\n`;
        output += `\n`;

        // Add <Start> rule with optional prefix and suffix
        output += `// Main Start rule with optional prefixes and suffixes\n`;
        output += `@ <Start> =\n`;
        output += `    (<Prefix_EN>)? <ActionStart> (<Suffix_EN>)? |\n`;
        output += `    (<Prefix_FR>)? <ActionStart> (<Suffix_FR>)?\n`;

        return output;
    }

    /**
     * Generate prefix/suffix pattern rules
     */
    private generatePrefixSuffixRules(): string {
        const englishPatterns = getPrefixSuffixPatterns("en");
        const frenchPatterns = getPrefixSuffixPatterns("fr");

        let output = `// English prefixes and suffixes\n`;
        output += this.generatePrefixSuffixRule(
            "PolitePrefix_EN",
            englishPatterns.politePrefixes,
        );
        output += this.generatePrefixSuffixRule(
            "DesirePrefix_EN",
            englishPatterns.desirePrefixes,
        );
        output += this.generatePrefixSuffixRule(
            "ActionInitiator_EN",
            englishPatterns.actionInitiators,
        );
        output += this.generatePrefixSuffixRule(
            "Greeting_EN",
            englishPatterns.greetings,
        );
        output += this.generatePrefixSuffixRule(
            "Acknowledgement_EN",
            englishPatterns.acknowledgements,
        );
        output += this.generatePrefixSuffixRule(
            "PoliteSuffix_EN",
            englishPatterns.politeSuffixes,
        );

        output += `\n// French prefixes and suffixes\n`;
        output += this.generatePrefixSuffixRule(
            "PolitePrefix_FR",
            frenchPatterns.politePrefixes,
        );
        output += this.generatePrefixSuffixRule(
            "DesirePrefix_FR",
            frenchPatterns.desirePrefixes,
        );
        output += this.generatePrefixSuffixRule(
            "ActionInitiator_FR",
            frenchPatterns.actionInitiators,
        );
        output += this.generatePrefixSuffixRule(
            "Greeting_FR",
            frenchPatterns.greetings,
        );
        output += this.generatePrefixSuffixRule(
            "Acknowledgement_FR",
            frenchPatterns.acknowledgements,
        );
        output += this.generatePrefixSuffixRule(
            "PoliteSuffix_FR",
            frenchPatterns.politeSuffixes,
        );

        return output;
    }

    /**
     * Escape special characters in quoted string literals
     * Special chars: \, @, |, (, ), <, >, $, -, {, }, [, ], '
     * Backslashes must be escaped first to avoid double-escaping
     */
    private escapeSpecialChars(text: string): string {
        return text
            .replace(/\\/g, "\\\\")
            .replace(/[@|()\[\]<>$\-{}']/g, "\\$&");
    }

    /**
     * Escape hyphens in unquoted grammar patterns
     * Only escapes standalone hyphens, not those in -> arrows or grammar syntax
     */
    private escapePatternHyphens(pattern: string): string {
        // Escape hyphens that aren't part of -> arrow
        // Look for hyphen not followed by >
        return pattern.replace(/-(?!>)/g, "\\-");
    }

    /**
     * Generate a single prefix/suffix rule
     */
    private generatePrefixSuffixRule(
        ruleName: string,
        patterns: string[],
    ): string {
        let output = `@ <${ruleName}> =\n`;
        patterns.forEach((pattern, index) => {
            const separator = index < patterns.length - 1 ? " |" : "";
            const escaped = this.escapeSpecialChars(pattern);
            output += `    '${escaped}'${separator}\n`;
        });
        return output;
    }

    /**
     * Build a complete rule with action object from a pattern
     */
    private buildRuleWithAction(
        pattern: string,
        actionInfo: ActionInfo,
        schemaInfo: SchemaInfo,
    ): string {
        // Extract wildcards and parameters from pattern
        const wildcardRegex = /\$\(([^:]+):([^)]+)\)/g;
        const parameterMappings: Array<{
            paramName: string;
            varName: string;
        }> = [];

        let match;
        while ((match = wildcardRegex.exec(pattern)) !== null) {
            const varName = match[1];
            parameterMappings.push({ paramName: varName, varName });
        }

        // Build action object
        let actionObject = `-> {\n        actionName: "${actionInfo.actionName}"`;

        if (parameterMappings.length > 0) {
            actionObject += `,\n        parameters: {\n`;
            const paramLines: string[] = [];

            for (const mapping of parameterMappings) {
                // Check if this is an array parameter (singular var name for plural param)
                const paramInfo = actionInfo.parameters.get(mapping.paramName);
                if (paramInfo) {
                    paramLines.push(
                        `            ${mapping.paramName}: $(${mapping.varName})`,
                    );
                } else {
                    // Try to find array parameter (e.g., "artist" -> "artists")
                    const pluralParam = mapping.paramName + "s";
                    const pluralInfo = actionInfo.parameters.get(pluralParam);
                    if (pluralInfo) {
                        paramLines.push(
                            `            ${pluralParam}: [$(${mapping.varName})]`,
                        );
                    } else {
                        // Fallback: use as-is
                        paramLines.push(
                            `            ${mapping.paramName}: $(${mapping.varName})`,
                        );
                    }
                }
            }

            actionObject += paramLines.join(",\n");
            actionObject += `\n        }`;
        }

        actionObject += `\n    }`;

        return `${pattern} ${actionObject}`;
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
}
