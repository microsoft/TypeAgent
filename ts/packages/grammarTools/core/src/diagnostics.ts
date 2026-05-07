// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseGrammarRules } from "action-grammar";
import type { LoadedGrammar, Diagnostic } from "./types.js";
import { MissingSourceError } from "./types.js";

/**
 * Run diagnostics on a loaded grammar.
 * Requires source files (throws MissingSourceError otherwise).
 *
 * Attempts to re-parse each source file and reports parse errors as
 * diagnostics. Semantic analysis (duplicate rules, unreachable
 * alternatives, etc.) will be added later.
 */
export function getDiagnostics(g: LoadedGrammar): Diagnostic[] {
    if (!g.files || g.files.length === 0) {
        throw new MissingSourceError(g.source);
    }

    const diagnostics: Diagnostic[] = [];

    for (const file of g.files) {
        try {
            parseGrammarRules(file.id, file.text);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            const loc = extractErrorLocation(message, file.text);
            diagnostics.push({
                range: loc,
                severity: "error",
                message: cleanErrorMessage(message),
                source: "grammar-tools-core",
            });
        }
    }

    return diagnostics;
}

/**
 * Try to extract line/col from an action-grammar error message.
 * Format: "filename:line:col: message" or "filename(line,col): message"
 */
function extractErrorLocation(
    message: string,
    text: string,
): { start: { line: number; character: number; offset: number }; end: { line: number; character: number; offset: number } } {
    // Pattern: "file:line:col: ..."
    const match = message.match(/:\s*(\d+):(\d+):/);
    if (match) {
        const line = parseInt(match[1], 10) - 1; // 0-based
        const character = parseInt(match[2], 10) - 1;
        const offset = positionToOffset(text, line, character);
        return {
            start: { line, character, offset },
            end: { line, character: character + 1, offset: offset + 1 },
        };
    }

    // Pattern: "file(line,col): ..."
    const match2 = message.match(/\((\d+),(\d+)\):/);
    if (match2) {
        const line = parseInt(match2[1], 10) - 1;
        const character = parseInt(match2[2], 10) - 1;
        const offset = positionToOffset(text, line, character);
        return {
            start: { line, character, offset },
            end: { line, character: character + 1, offset: offset + 1 },
        };
    }

    // Fallback: first character
    return {
        start: { line: 0, character: 0, offset: 0 },
        end: { line: 0, character: 0, offset: 0 },
    };
}

function cleanErrorMessage(message: string): string {
    // Strip the "filename:line:col: " prefix if present
    const cleaned = message.replace(/^[^:]+:\d+:\d+:\s*/, "");
    // Strip "Error detected in grammar compilation ..." wrapper
    const lines = cleaned.split("\n");
    if (lines[0]?.startsWith("Error detected in grammar compilation")) {
        return lines.slice(1).join("\n").trim();
    }
    return cleaned;
}

function positionToOffset(text: string, line: number, character: number): number {
    let currentLine = 0;
    let offset = 0;
    while (currentLine < line && offset < text.length) {
        if (text[offset] === "\n") {
            currentLine++;
        }
        offset++;
    }
    return offset + character;
}
