// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type GrammarPatternInput =
    | string
    | { pattern: string; isAlias?: boolean };

export function generateGrammarRuleText(
    actionName: string,
    patterns: GrammarPatternInput[],
): string {
    const rules: string[] = [];
    let aliasIndex = 0;

    for (const p of patterns) {
        const patternStr = typeof p === "string" ? p : p.pattern;
        const isAlias = typeof p === "object" && p.isAlias === true;

        const ruleName = isAlias
            ? `${actionName}Alias${++aliasIndex}`
            : actionName;

        const captures = [...patternStr.matchAll(/\$\((\w+):\w+\)/g)].map(
            (m) => m[1],
        );
        const paramJson =
            captures.length > 0 ? `{ ${captures.join(", ")} }` : "{}";

        rules.push(
            `<${ruleName}> [spacing=optional] = ${patternStr}` +
                ` -> { actionName: "${actionName}", parameters: ${paramJson} };`,
        );
    }

    return rules.join("\n");
}

export function extractRuleNames(grammarRuleText: string): string[] {
    const names: string[] = [];
    for (const line of grammarRuleText.split("\n")) {
        const m = line.match(/^<(\w+)>/);
        if (m && !names.includes(m[1])) {
            names.push(m[1]);
        }
    }
    return names;
}

export function buildStartRule(ruleNames: string[]): string {
    return `<Start> = ${ruleNames.map((n) => `<${n}>`).join(" | ")};`;
}

export interface GrammarEntry {
    grammarRuleText?: string;
    enabled?: boolean;
}

export function assembleDynamicGrammar(
    entries: Iterable<GrammarEntry>,
    builtInRuleNames?: string[],
    builtInRuleTexts?: string[],
): string {
    const ruleNames: string[] = builtInRuleNames
        ? [...builtInRuleNames]
        : [];
    const ruleTexts: string[] = builtInRuleTexts
        ? [...builtInRuleTexts]
        : [];

    for (const entry of entries) {
        if (entry.enabled === false) continue;
        if (!entry.grammarRuleText) continue;
        ruleTexts.push(entry.grammarRuleText);
        for (const name of extractRuleNames(entry.grammarRuleText)) {
            if (!ruleNames.includes(name)) {
                ruleNames.push(name);
            }
        }
    }

    if (ruleNames.length === 0) return "";

    const startRule = buildStartRule(ruleNames);
    return `${startRule}\n\n${ruleTexts.join("\n\n")}`;
}
