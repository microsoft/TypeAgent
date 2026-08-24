// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Parser for DroidCall's code/code_short assistant format. It intentionally
// mirrors the upstream convention: resultN on the right-hand side becomes #N.

import { parsePythonLiteral, type PythonLiteral } from "../pythonLiteral.js";

export interface DroidCall {
    id: number;
    name: string;
    arguments: Record<string, PythonLiteral>;
    positionalArguments?: PythonLiteral[];
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

// Quote bare resultN tokens so the Python-literal parser can preserve them
// inside lists and dictionaries without changing ordinary string contents.
function replaceResultReferences(text: string): string {
    let output = "";
    let quote: string | undefined;
    let escaped = false;
    for (let index = 0; index < text.length; index++) {
        const character = text[index]!;
        if (quote !== undefined) {
            output += character;
            if (escaped) escaped = false;
            else if (character === "\\") escaped = true;
            else if (character === quote) quote = undefined;
            continue;
        }
        if (character === '"' || character === "'") {
            quote = character;
            output += character;
            continue;
        }
        const reference = /^result(\d+)\b/.exec(text.slice(index));
        const previous = index === 0 ? undefined : text[index - 1];
        if (
            reference !== null &&
            (previous === undefined || !/\w/.test(previous))
        ) {
            output += JSON.stringify(`#${reference[1]}`);
            index += reference[0].length - 1;
            continue;
        }
        output += character;
    }
    return output;
}

function parseValue(text: string): PythonLiteral {
    return parsePythonLiteral(replaceResultReferences(text.trim()));
}

function parseArguments(text: string): {
    arguments: Record<string, PythonLiteral>;
    positionalArguments: PythonLiteral[];
} {
    const args = Object.create(null) as Record<string, PythonLiteral>;
    const positionalArguments: PythonLiteral[] = [];
    for (const part of splitTopLevel(text)) {
        const equals = findTopLevelEquals(part);
        if (equals < 0) {
            positionalArguments.push(parseValue(part));
            continue;
        }
        if (equals === 0) throw new Error(`invalid argument: ${part}`);
        const name = part.slice(0, equals).trim();
        if (!/^\w+$/.test(name))
            throw new Error(`invalid argument name: ${name}`);
        args[name] = parseValue(part.slice(equals + 1));
    }
    return { arguments: args, positionalArguments };
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
        const parsed = parseArguments(text.slice(open + 1, close));
        const id = Number(match[1]);
        if (!Number.isSafeInteger(id)) {
            throw new RangeError(`invalid result id: ${match[1]}`);
        }
        calls.push({
            id,
            name: match[2]!,
            arguments: parsed.arguments,
            ...(parsed.positionalArguments.length === 0
                ? {}
                : { positionalArguments: parsed.positionalArguments }),
        });
        pattern.lastIndex = close + 1;
    }
    return calls;
}

const RESULT_REFERENCE = /^#\d+$/;

export function hasDroidCallResultReference(value: unknown): boolean {
    if (typeof value === "string") return RESULT_REFERENCE.test(value);
    if (Array.isArray(value)) return value.some(hasDroidCallResultReference);
    if (typeof value === "object" && value !== null) {
        return Object.values(value).some(hasDroidCallResultReference);
    }
    return false;
}

export type DroidCallShape =
    | "noCall"
    | "singleTool"
    | "multiCallNested"
    | "multiCallWithoutNested";

export function classifyDroidCalls(calls: DroidCall[]): DroidCallShape {
    if (calls.length === 0) return "noCall";
    if (calls.length === 1) return "singleTool";
    return calls.some(
        (call) =>
            hasDroidCallResultReference(call.arguments) ||
            hasDroidCallResultReference(call.positionalArguments),
    )
        ? "multiCallNested"
        : "multiCallWithoutNested";
}
