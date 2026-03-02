// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Built-in Grammar Categories
 *
 * Reusable AGR rule fragments that Claude can reference in generated grammar rules.
 * When Claude uses a category (e.g., (<Polite>)?) in a matchPattern, formatAsGrammarRule
 * automatically inlines the category definition into the generated grammar text so that
 * the stored grammar is fully self-contained.
 *
 * Naming convention for prompt use: <CategoryName>
 * Usage in patterns: (<CategoryName>)?   (note: (<Name>)? not <Name>? — bare optional not yet supported)
 */
export interface BuiltInGrammarCategory {
    /** AGR rule name — used as <Name> in patterns */
    name: string;
    /** Shown to Claude in the generator prompt */
    description: string;
    /** Example phrases, for Claude's context */
    examples: string[];
    /** Complete AGR rule definition: <Name> = alt1 | alt2 | ... ; */
    ruleText: string;
}

export const BUILT_IN_GRAMMAR_CATEGORIES: BuiltInGrammarCategory[] = [
    {
        name: "Polite",
        description:
            "Optional polite opener — courtesy phrases at the start of a request",
        examples: [
            "please",
            "could you",
            "would you",
            "can you",
            "would you please",
        ],
        ruleText: `<Polite> = please | could you | would you | would you please | can you | kindly;`,
    },
    {
        name: "Greeting",
        description:
            "Optional greeting at the start of a request before the main command",
        examples: ["hey", "hi", "ok", "okay", "alright", "yo", "hello"],
        ruleText: `<Greeting> = hey | hi | ok | okay | alright | hello | yo;`,
    },
    {
        name: "Acknowledgement",
        description:
            "Optional acknowledgement at the start (e.g., after completing a prior task)",
        examples: [
            "thanks",
            "thank you",
            "great",
            "perfect",
            "good",
            "nice",
            "cool",
        ],
        ruleText: `<Acknowledgement> = thanks | thank you | great | perfect | good | nice | cool;`,
    },
    {
        name: "FillerWord",
        description:
            "Optional hesitation or filler word that can appear inline in a request",
        examples: ["um", "uh", "like", "well", "so", "just", "basically"],
        ruleText: `<FillerWord> = um | uh | like | well | so | just | basically | actually;`,
    },
];

/**
 * Get a built-in category by name
 */
export function getBuiltInCategory(
    name: string,
): BuiltInGrammarCategory | undefined {
    return BUILT_IN_GRAMMAR_CATEGORIES.find((c) => c.name === name);
}

/**
 * Get the set of all built-in category names
 */
export function getBuiltInCategoryNames(): Set<string> {
    return new Set(BUILT_IN_GRAMMAR_CATEGORIES.map((c) => c.name));
}

/**
 * Get descriptions of all built-in categories for inclusion in the generator prompt
 */
export function getBuiltInCategoryDescriptions(): string {
    return BUILT_IN_GRAMMAR_CATEGORIES.map(
        (cat) =>
            `  <${cat.name}> — ${cat.description}\n    Examples: ${cat.examples.join(", ")}`,
    ).join("\n");
}

/**
 * Find all built-in categories referenced in a matchPattern string.
 * Matches bare <CategoryName> tokens (but not $(...) variable captures).
 */
export function getReferencedCategories(
    matchPattern: string,
): BuiltInGrammarCategory[] {
    const catNames = getBuiltInCategoryNames();
    const referenced: BuiltInGrammarCategory[] = [];
    // Match <Name> that is a known built-in category
    const ruleRefPattern = /<(\w+)>/g;
    let m: RegExpExecArray | null;
    const seen = new Set<string>();
    while ((m = ruleRefPattern.exec(matchPattern)) !== null) {
        const name = m[1];
        if (catNames.has(name) && !seen.has(name)) {
            seen.add(name);
            referenced.push(getBuiltInCategory(name)!);
        }
    }
    return referenced;
}
