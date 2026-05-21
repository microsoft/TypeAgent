// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Semantic tokens feature.
 *
 * Colorizes identifier references by what they resolve to:
 *  - workflow parameters and lambda parameters    -> "parameter"
 *  - top-level const bindings                     -> "variable" + "readonly" modifier
 *  - task calls (e.g. `shell.exec`)               -> "function"
 *  - resolved property accesses (e.g. `.stdout`)  -> "property"
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

const TOKEN_TYPES = ["parameter", "variable", "function", "property"] as const;
type TokenType = (typeof TOKEN_TYPES)[number];

const TYPE_INDEX: Record<TokenType, number> = {
    parameter: 0,
    variable: 1,
    function: 2,
    property: 3,
};

const TOKEN_MODIFIERS = ["readonly"] as const;
type TokenModifier = (typeof TOKEN_MODIFIERS)[number];

/** Bitmask for a set of modifiers. */
function modifierMask(...mods: TokenModifier[]): number {
    return mods.reduce((acc, m) => acc | (1 << TOKEN_MODIFIERS.indexOf(m)), 0);
}

export const semanticTokensLegend: SemanticTokensLegend = {
    tokenTypes: [...TOKEN_TYPES],
    tokenModifiers: [...TOKEN_MODIFIERS],
};

export function computeSemanticTokens(doc: TextDocument): SemanticTokens {
    const parsed = getParsed(doc);
    const builder = new SemanticTokensBuilder();
    if (!parsed.symbols) return builder.build();

    // Sort by (line, col) so the LSP delta encoding is monotonic.
    type Entry = {
        line: number;
        col: number;
        length: number;
        type: TokenType;
        modifier: number;
    };
    const entries: Entry[] = [];

    for (const ref of parsed.symbols.refs) {
        if (!ref.def) continue;
        const isParam =
            ref.def.kind === "param" || ref.def.kind === "lambdaParam";
        entries.push({
            line: ref.loc.line - 1,
            col: ref.loc.col - 1,
            length: ref.name.length,
            type: isParam ? "parameter" : "variable",
            // Const bindings are immutable - mark readonly so themes color them
            // distinctly from mutable variables (matches TypeScript behavior).
            modifier: !isParam ? modifierMask("readonly") : 0,
        });
    }
    for (const task of parsed.symbols.taskRefs) {
        entries.push({
            line: task.loc.line - 1,
            col: task.loc.col - 1,
            length: task.name.length,
            type: "function",
            modifier: 0,
        });
    }

    // Emit property tokens for resolved property accesses (e.g. `.stdout`).
    for (const ref of parsed.propertyRefs ?? []) {
        entries.push({
            line: ref.line - 1,
            col: ref.col - 1,
            length: ref.length,
            type: "property",
            modifier: 0,
        });
    }

    entries.sort((a, b) => a.line - b.line || a.col - b.col);

    for (const e of entries) {
        builder.push(e.line, e.col, e.length, TYPE_INDEX[e.type], e.modifier);
    }
    return builder.build();
}
