// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Conversions between the DSL's `SourceLocation` (1-based line/col)
 * and LSP `Position` / `Range` (0-based).
 *
 * The DSL AST attaches a single `loc` per node (start position only).
 * Many LSP operations need a Range; for those we synthesize a
 * single-character range at `loc` unless an explicit end column is
 * known. Features that need spans (e.g., rename) compute end from the
 * token text length.
 */

import type { Range, Position } from "vscode-languageserver/node.js";

export interface SourceLocation {
    line: number; // 1-based
    col: number; // 1-based
    offset?: number;
}

export function toLspPosition(loc: SourceLocation): Position {
    return {
        line: Math.max(0, loc.line - 1),
        character: Math.max(0, loc.col - 1),
    };
}

/** Build a range from start/end source locations (both 1-based). */
export function toLspRange(start: SourceLocation, end: SourceLocation): Range {
    return { start: toLspPosition(start), end: toLspPosition(end) };
}

/**
 * Range covering `length` characters starting at `loc`. Used for
 * diagnostics where only a start location is available; clamping the
 * range to a single line keeps the squiggle from running off forever.
 */
export function pointRange(loc: SourceLocation, length: number = 1): Range {
    const start = toLspPosition(loc);
    return {
        start,
        end: {
            line: start.line,
            character: start.character + Math.max(1, length),
        },
    };
}

export function fromLspPosition(pos: Position): SourceLocation {
    return { line: pos.line + 1, col: pos.character + 1 };
}
