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

const SPACING_MARKER = "[spacing=optional]";
const ACTION_NAME_PROPERTY = "actionName:";

function isWhitespace(character: string): boolean {
    return character.trim().length === 0;
}

function skipWhitespace(text: string, offset: number): number {
    while (offset < text.length && isWhitespace(text[offset])) {
        offset++;
    }
    return offset;
}

function hasRuleNameCharacters(name: string): boolean {
    if (name.length === 0) return false;
    for (const character of name) {
        const code = character.charCodeAt(0);
        const isDigit = code >= 48 && code <= 57;
        const isUppercase = code >= 65 && code <= 90;
        const isLowercase = code >= 97 && code <= 122;
        if (!isDigit && !isUppercase && !isLowercase && character !== "_") {
            return false;
        }
    }
    return true;
}

function extractRulePattern(line: string): string | undefined {
    if (!line.startsWith("<")) return undefined;

    const ruleNameEnd = line.indexOf(">", 1);
    if (ruleNameEnd < 0 || !hasRuleNameCharacters(line.slice(1, ruleNameEnd))) {
        return undefined;
    }

    let offset = ruleNameEnd + 1;
    const spacingMarkerStart = skipWhitespace(line, offset);
    if (
        spacingMarkerStart === offset ||
        !line.startsWith(SPACING_MARKER, spacingMarkerStart)
    ) {
        return undefined;
    }

    offset = spacingMarkerStart + SPACING_MARKER.length;
    const equals = skipWhitespace(line, offset);
    if (equals === offset || line[equals] !== "=") return undefined;

    offset = equals + 1;
    const patternStart = skipWhitespace(line, offset);
    if (patternStart === offset) return undefined;

    const arrow = line.lastIndexOf("->");
    if (arrow <= patternStart) return undefined;

    let patternEnd = arrow;
    while (patternEnd > patternStart && isWhitespace(line[patternEnd - 1])) {
        patternEnd--;
    }
    if (patternEnd === arrow || patternEnd === patternStart) return undefined;

    offset = arrow + 2;
    const openingBrace = skipWhitespace(line, offset);
    if (openingBrace === offset || line[openingBrace] !== "{") return undefined;

    offset = openingBrace + 1;
    const actionName = skipWhitespace(line, offset);
    if (
        actionName === offset ||
        !line.startsWith(ACTION_NAME_PROPERTY, actionName)
    ) {
        return undefined;
    }

    return line.slice(patternStart, patternEnd);
}

export function extractRulePatterns(
    grammarRuleText: string | undefined,
): string[] {
    const patterns: string[] = [];
    for (const line of (grammarRuleText ?? "").split("\n")) {
        const pattern = extractRulePattern(line);
        if (pattern !== undefined) patterns.push(pattern);
    }
    return patterns;
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
    const ruleNames: string[] = builtInRuleNames ? [...builtInRuleNames] : [];
    const ruleTexts: string[] = builtInRuleTexts ? [...builtInRuleTexts] : [];

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
