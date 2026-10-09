// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Parser for DroidCall's code/code_short assistant format. It intentionally
// mirrors the upstream convention: resultN on the right-hand side becomes #N.

import {
    parsePythonLiteral,
    type PyValue,
} from "../Seal-Tools/pythonLiteral.js";

export interface DroidCall {
    id: number;
    name: string;
    arguments: Record<string, PyValue>;
}

function splitTopLevel(text: string): string[] {
    const parts: string[] = [];
    let start = 0;
    let quote: string | undefined;
    let escaped = false;
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text[i]!;
        if (quote !== undefined) {
            if (escaped) escaped = false;
            else if (char === "\\") escaped = true;
            else if (char === quote) quote = undefined;
            continue;
        }
        if (char === '"' || char === "'") quote = char;
        else if (char === "[" || char === "{" || char === "(") depth++;
        else if (char === "]" || char === "}" || char === ")") depth--;
        else if (char === "," && depth === 0) {
            parts.push(text.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(text.slice(start));
    return parts.filter((part) => part.trim().length > 0);
}

function findTopLevelEquals(text: string): number {
    let quote: string | undefined;
    let escaped = false;
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text[i]!;
        if (quote !== undefined) {
            if (escaped) escaped = false;
            else if (char === "\\") escaped = true;
            else if (char === quote) quote = undefined;
            continue;
        }
        if (char === '"' || char === "'") quote = char;
        else if (char === "[" || char === "{" || char === "(") depth++;
        else if (char === "]" || char === "}" || char === ")") depth--;
        else if (char === "=" && depth === 0) return i;
    }
    return -1;
}

function findClosingParen(text: string, open: number): number {
    let quote: string | undefined;
    let escaped = false;
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        const char = text[i]!;
        if (quote !== undefined) {
            if (escaped) escaped = false;
            else if (char === "\\") escaped = true;
            else if (char === quote) quote = undefined;
            continue;
        }
        if (char === '"' || char === "'") quote = char;
        else if (char === "(") depth++;
        else if (char === ")" && --depth === 0) return i;
    }
    throw new Error(`unterminated function call at index ${open}`);
}

function parseValue(text: string): PyValue {
    const trimmed = text.trim();
    const reference = /^result(\d+)$/.exec(trimmed);
    if (reference !== null) return `#${reference[1]}`;
    const parsed = parsePythonLiteral(trimmed);
    if (trimmed.slice(parsed.end).trim().length > 0) {
        throw new Error(
            `unexpected text after value: ${trimmed.slice(parsed.end)}`,
        );
    }
    return parsed.value;
}

function parseArguments(text: string): Record<string, PyValue> {
    const args: Record<string, PyValue> = {};
    for (const part of splitTopLevel(text)) {
        const equals = findTopLevelEquals(part);
        if (equals < 1) throw new Error(`invalid argument: ${part}`);
        const name = part.slice(0, equals).trim();
        if (!/^\w+$/.test(name))
            throw new Error(`invalid argument name: ${name}`);
        args[name] = parseValue(part.slice(equals + 1));
    }
    return args;
}

export function parseDroidCallCode(text: string): DroidCall[] {
    const calls: DroidCall[] = [];
    const pattern = /\bresult(\d+)\s*=\s*([A-Za-z_]\w*)\s*\(/g;
    for (
        let match = pattern.exec(text);
        match !== null;
        match = pattern.exec(text)
    ) {
        const open = pattern.lastIndex - 1;
        const close = findClosingParen(text, open);
        calls.push({
            id: Number(match[1]),
            name: match[2]!,
            arguments: parseArguments(text.slice(open + 1, close)),
        });
        pattern.lastIndex = close + 1;
    }
    return calls;
}

const RESULT_REFERENCE = /#\d+\b/;

export function hasDroidCallResultReference(value: unknown): boolean {
    if (typeof value === "string") return RESULT_REFERENCE.test(value);
    if (Array.isArray(value)) return value.some(hasDroidCallResultReference);
    if (typeof value === "object" && value !== null) {
        return Object.values(value).some(hasDroidCallResultReference);
    }
    return false;
}

export type DroidCallShape =
    | "singleTool"
    | "multiCallNested"
    | "multiCallWithoutNested";

export function classifyDroidCalls(calls: DroidCall[]): DroidCallShape {
    if (calls.length === 1) return "singleTool";
    return calls.some((call) => hasDroidCallResultReference(call.arguments))
        ? "multiCallNested"
        : "multiCallWithoutNested";
}
