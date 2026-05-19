// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Conversions between the DSL's `SourceLocation` (1-based line/column)
 * and LSP `Position` / `Range` (0-based).
 */

import type { Range, Position } from "vscode-languageserver/node.js";

export interface SourceLocation {
    line: number; // 1-based
    column: number; // 1-based
}

export interface SourceSpan {
    start: SourceLocation;
    end: SourceLocation;
}

export function toLspPosition(loc: SourceLocation): Position {
    return {
        line: Math.max(0, loc.line - 1),
        character: Math.max(0, loc.column - 1),
    };
}

export function toLspRange(span: SourceSpan): Range {
    return {
        start: toLspPosition(span.start),
        end: toLspPosition(span.end),
    };
}

export function fromLspPosition(pos: Position): SourceLocation {
    return { line: pos.line + 1, column: pos.character + 1 };
}
