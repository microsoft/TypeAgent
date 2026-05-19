// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Semantic tokens feature.
 *
 * Colorizes identifier references by what they resolve to:
 *  - workflow parameters and lambda parameters    -> "parameter"
 *  - top-level const bindings                     -> "variable"
 *  - task calls (e.g. `shell.exec`)               -> "function"
 *
 * Bare identifiers that don't resolve to anything (parse errors,
 * unknown names) are skipped — the diagnostics feature already
 * surfaces those.
 *
 * The token legend is exposed at server registration time so VS Code
 * picks the right theme colors.
 */

import {
    SemanticTokens,
    SemanticTokensBuilder,
    SemanticTokensLegend,
} from "vscode-languageserver/node.js";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { getParsed } from "../parsedDocument.js";

const TOKEN_TYPES = ["parameter", "variable", "function"] as const;
type TokenType = (typeof TOKEN_TYPES)[number];

const TYPE_INDEX: Record<TokenType, number> = {
    parameter: 0,
    variable: 1,
    function: 2,
};

export const semanticTokensLegend: SemanticTokensLegend = {
    tokenTypes: [...TOKEN_TYPES],
    tokenModifiers: [],
};

export function computeSemanticTokens(doc: TextDocument): SemanticTokens {
    const parsed = getParsed(doc);
    const builder = new SemanticTokensBuilder();
    if (!parsed.symbols) return builder.build();

    // Sort by (line, col) so the LSP delta encoding is monotonic.
    type Entry = { line: number; col: number; length: number; type: TokenType };
    const entries: Entry[] = [];

    for (const ref of parsed.symbols.refs) {
        if (!ref.def) continue;
        entries.push({
            line: ref.loc.line - 1,
            col: ref.loc.col - 1,
            length: ref.name.length,
            type:
                ref.def.kind === "param" || ref.def.kind === "lambdaParam"
                    ? "parameter"
                    : "variable",
        });
    }
    for (const task of parsed.symbols.taskRefs) {
        entries.push({
            line: task.loc.line - 1,
            col: task.loc.col - 1,
            length: task.name.length,
            type: "function",
        });
    }

    entries.sort((a, b) => a.line - b.line || a.col - b.col);

    for (const e of entries) {
        builder.push(e.line, e.col, e.length, TYPE_INDEX[e.type], 0);
    }
    return builder.build();
}
