// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    parseGrammarRules,
    grammarFromJson,
    type Grammar,
    type GrammarParseResult,
    type RuleDefinition,
} from "@typeagent/action-grammar";
import { lowerFirst, normalizeSpaces } from "./util.js";

// The parser's per-alternate and expression node types are not exported by
// name, so we walk the parsed value/expression nodes defensively (with `any`),
// since they form a large discriminated union we only read a few fields from.

const MAX_PHRASINGS = 8;
const MAX_DEPTH = 4;

/**
 * Parse an `.agr` grammar and produce, for each action name, a list of example
 * natural-language phrasings. Literal tokens are rendered as-is, captured
 * variables become `{slot}` placeholders, referenced rules are expanded
 * shallowly, and optional groups are dropped for readability.
 *
 * Returns an empty map when the grammar cannot be parsed — phrasings are a
 * best-effort enrichment and never block catalog generation.
 */
export function extractPhrasings(
    fileName: string,
    content: string,
): Map<string, string[]> {
    const result = new Map<string, string[]>();
    let parsed: GrammarParseResult;
    try {
        parsed = parseGrammarRules(fileName, content);
    } catch {
        return result;
    }

    const defs = new Map<string, RuleDefinition>();
    for (const def of parsed.definitions) {
        defs.set(def.definitionName.name, def);
    }

    for (const def of parsed.definitions) {
        for (const rule of def.rules) {
            const actionName = getActionName(rule.value);
            if (actionName === undefined) {
                continue;
            }
            const phrase = renderExpressions(rule.expressions, defs, 0);
            if (phrase.length > 0) {
                addPhrase(result, actionName, phrase);
            }
        }
    }
    return result;
}

/** Extract the `actionName` string literal from a rule's `-> { ... }` value. */
function getActionName(value: unknown): string | undefined {
    const node = value as any;
    if (
        node === undefined ||
        node === null ||
        node.type !== "object" ||
        !Array.isArray(node.value)
    ) {
        return undefined;
    }
    for (const element of node.value) {
        if (
            element !== null &&
            element.type === "property" &&
            element.key === "actionName"
        ) {
            const propValue = element.value;
            if (
                propValue !== null &&
                propValue !== undefined &&
                propValue.type === "literal" &&
                typeof propValue.value === "string"
            ) {
                return propValue.value;
            }
        }
    }
    return undefined;
}

function renderExpressions(
    expressions: unknown,
    defs: Map<string, RuleDefinition>,
    depth: number,
): string {
    if (!Array.isArray(expressions)) {
        return "";
    }
    const parts: string[] = [];
    for (const expr of expressions) {
        const rendered = renderExpr(expr, defs, depth);
        if (rendered.length > 0) {
            parts.push(rendered);
        }
    }
    return normalizeSpaces(parts.join(" "));
}

function renderExpr(
    expr: any,
    defs: Map<string, RuleDefinition>,
    depth: number,
): string {
    switch (expr?.type) {
        case "string":
            return Array.isArray(expr.value) ? expr.value.join(" ") : "";
        case "variable": {
            // A capture like `$(trackName:<TrackName>)` — the slot name is the
            // most meaningful placeholder for the reader.
            const name = expr.variableName?.name;
            return typeof name === "string" && name.length > 0
                ? `{${name}}`
                : "";
        }
        case "ruleReference":
            return renderRuleRef(expr.refName?.name, defs, depth);
        case "rules": {
            // Drop optional groups to keep the canonical phrasing clean; for a
            // required group, render its first alternative.
            if (expr.optional === true || expr.repeat === true) {
                return "";
            }
            const first = expr.rules?.[0];
            return first
                ? renderExpressions(first.expressions, defs, depth)
                : "";
        }
        default:
            return "";
    }
}

function renderRuleRef(
    name: unknown,
    defs: Map<string, RuleDefinition>,
    depth: number,
): string {
    if (typeof name !== "string" || name.length === 0) {
        return "";
    }
    const placeholder = `{${lowerFirst(name)}}`;
    if (depth >= MAX_DEPTH) {
        return placeholder;
    }
    const def = defs.get(name);
    if (def === undefined) {
        // Referenced rule is defined elsewhere (e.g. an imported entity such as
        // <Ordinal>); render it as a placeholder slot.
        return placeholder;
    }
    const first = def.rules?.[0];
    if (first === undefined) {
        return placeholder;
    }
    const rendered = renderExpressions(first.expressions, defs, depth + 1);
    return rendered.length > 0 ? rendered : placeholder;
}

function addPhrase(
    result: Map<string, string[]>,
    actionName: string,
    phrase: string,
): void {
    if (!isUsefulPhrase(phrase)) {
        return;
    }
    let list = result.get(actionName);
    if (list === undefined) {
        list = [];
        result.set(actionName, list);
    }
    if (list.length < MAX_PHRASINGS && !list.includes(phrase)) {
        list.push(phrase);
    }
}

/**
 * Reject phrasings that would confuse rather than help: those carrying an
 * internal optimizer slot (e.g. `{__opt_v_3}`, introduced when a compiled
 * grammar was inlined/factored) or those with no literal words at all (a bare
 * `{slot}` teaches nothing).
 */
function isUsefulPhrase(phrase: string): boolean {
    if (phrase.includes("{__")) {
        return false;
    }
    const withoutSlots = phrase.replace(/\{[^}]*\}/g, " ");
    return /[a-z]/i.test(withoutSlots);
}

/**
 * Extract example phrasings from a pre-compiled grammar (`.ag.json`). Most
 * bundled agents ship this optimized form rather than raw `.agr`. Each leaf
 * production is self-contained (full token sequence plus its action value), so
 * we walk every reachable rule, and for those carrying an `actionName` render
 * their parts into a phrase.
 */
export function extractCompiledPhrasings(
    content: string,
): Map<string, string[]> {
    const result = new Map<string, string[]>();
    let grammar: Grammar;
    try {
        grammar = grammarFromJson(JSON.parse(content));
    } catch {
        return result;
    }

    const seen = new Set<object>();
    // The top-level grammar shares the {alternatives, dispatch} shape of a
    // RulesPart; optimized grammars keep their entry rules in `dispatch`, so
    // seed from both.
    const stack: any[] = compiledAlternatives(grammar);
    while (stack.length > 0) {
        const rule = stack.pop();
        if (rule === undefined || rule === null || seen.has(rule)) {
            continue;
        }
        seen.add(rule);

        const actionName = getActionName(rule.value);
        if (actionName !== undefined) {
            const phrase = renderCompiledParts(rule.parts, 0);
            if (phrase.length > 0) {
                addPhrase(result, actionName, phrase);
            }
        }

        // Descend into nested alternations to reach every leaf production.
        if (Array.isArray(rule.parts)) {
            for (const part of rule.parts) {
                if (part?.type === "rules") {
                    for (const alt of compiledAlternatives(part)) {
                        stack.push(alt);
                    }
                }
            }
        }
    }
    return result;
}

function renderCompiledParts(parts: unknown, depth: number): string {
    if (!Array.isArray(parts)) {
        return "";
    }
    const rendered: string[] = [];
    for (const part of parts) {
        const piece = renderCompiledPart(part, depth);
        if (piece.length > 0) {
            rendered.push(piece);
        }
    }
    return normalizeSpaces(rendered.join(" "));
}

function renderCompiledPart(part: any, depth: number): string {
    switch (part?.type) {
        case "string":
            return Array.isArray(part.value) ? part.value.join(" ") : "";
        case "wildcard":
        case "number":
            return typeof part.variable === "string" && part.variable.length > 0
                ? `{${part.variable}}`
                : "";
        case "phraseSet":
            return typeof part.variable === "string" && part.variable.length > 0
                ? `{${part.variable}}`
                : "";
        case "rules": {
            if (part.optional === true || part.repeat === true) {
                return "";
            }
            if (typeof part.variable === "string" && part.variable.length > 0) {
                return `{${part.variable}}`;
            }
            if (depth >= MAX_DEPTH) {
                return "";
            }
            const first = compiledAlternatives(part)[0];
            return first ? renderCompiledParts(first.parts, depth + 1) : "";
        }
        default:
            return "";
    }
}

/** All member rules of a compiled alternation (direct + dispatch buckets). */
function compiledAlternatives(rulesPart: any): any[] {
    const members: any[] = Array.isArray(rulesPart?.alternatives)
        ? [...rulesPart.alternatives]
        : [];
    const dispatch = rulesPart?.dispatch;
    if (Array.isArray(dispatch)) {
        for (const bucket of dispatch) {
            const tokenMap = bucket?.tokenMap;
            if (tokenMap && typeof tokenMap.values === "function") {
                for (const arr of tokenMap.values()) {
                    if (Array.isArray(arr)) {
                        members.push(...arr);
                    }
                }
            }
        }
    }
    return members;
}
