// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Shared scanning of raw LLM responses for embedded JSON. Seal-Tools and
// DroidCall both extract JSON candidates from noisy provider text and preserve
// number lexemes (via PythonNumber) so Python spellings compare exactly. This
// module deduplicates that logic: a balanced-brace scanner, a number-lexeme
// JSON parser, and a plain-object type guard.

import { PythonNumber } from "./pythonLiteral.js";

// Return the end of one balanced JSON object or array candidate.
export function findBalancedJsonEnd(
    text: string,
    start: number,
): number | undefined {
    const stack: string[] = [];
    let quoted = false;
    let escaped = false;
    for (let index = start; index < text.length; index++) {
        const character = text[index]!;
        if (quoted) {
            if (escaped) escaped = false;
            else if (character === "\\") escaped = true;
            else if (character === '"') quoted = false;
            continue;
        }
        if (character === '"') {
            quoted = true;
            continue;
        }
        if (character === "{" || character === "[") {
            stack.push(character);
            continue;
        }
        if (character !== "}" && character !== "]") continue;

        const opener = stack.pop();
        const matches =
            (opener === "{" && character === "}") ||
            (opener === "[" && character === "]");
        if (!matches) return undefined;
        if (stack.length === 0) return index + 1;
    }
    return undefined;
}

// Objects as named records; arrays and scalars are rejected.
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface ParsePythonLexemeJsonOptions {
    // Return every JSON candidate found instead of the first that parses.
    multiple?: boolean;
    // Reject oversized responses (applied only when scanning for multiple).
    maxLength?: number;
    // Reject responses with too many candidate starts (multiple only).
    maxCandidates?: number;
}

const parseWithReviver = JSON.parse as unknown as (
    source: string,
    reviver: (
        key: string,
        value: unknown,
        context?: { source?: string },
    ) => unknown,
) => unknown;

// Preserve JSON number lexemes because Seal and DroidCall compare their Python
// spellings. With multiple=false, return the first candidate that parses.
export function parsePythonLexemeJson(
    text: string,
    options?: { multiple?: false },
): unknown;
export function parsePythonLexemeJson(
    text: string,
    options: ParsePythonLexemeJsonOptions & { multiple: true },
): unknown[];
export function parsePythonLexemeJson(
    text: string,
    options: ParsePythonLexemeJsonOptions = {},
): unknown | unknown[] {
    if (options.multiple) {
        if (
            options.maxLength !== undefined &&
            text.length > options.maxLength
        ) {
            throw new SyntaxError("Response exceeds maxLength");
        }
        const values: unknown[] = [];
        let candidateCount = 0;
        for (let start = 0; start < text.length; start++) {
            if (text[start] !== "{" && text[start] !== "[") continue;
            candidateCount++;
            if (
                options.maxCandidates !== undefined &&
                candidateCount > options.maxCandidates
            ) {
                throw new SyntaxError("Response exceeds maxJsonCandidates");
            }
            const end = findBalancedJsonEnd(text, start);
            if (end === undefined) continue;
            try {
                values.push(parseCandidate(text.slice(start, end)));
                start = end - 1;
            } catch {
                // A balanced prose fragment may precede the JSON response.
            }
        }
        if (values.length === 0) {
            throw new SyntaxError("Response does not contain valid JSON");
        }
        return values;
    }

    for (let start = 0; start < text.length; start++) {
        if (text[start] !== "{" && text[start] !== "[") continue;
        const end = findBalancedJsonEnd(text, start);
        if (end === undefined) continue;
        try {
            return parseCandidate(text.slice(start, end));
        } catch {
            // A balanced prose fragment may precede the actual JSON document.
        }
    }
    throw new SyntaxError("Response does not contain valid JSON");
}

function parseCandidate(source: string): unknown {
    return parseWithReviver(source, (_key, value, context) => {
        if (typeof value !== "number") return value;
        if (context?.source === undefined) {
            throw new Error("JSON.parse does not expose number lexemes");
        }
        return new PythonNumber(context.source);
    });
}
