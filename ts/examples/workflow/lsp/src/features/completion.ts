// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Completion feature.
 *
 * Surfaces three categories of items:
 *  1. DSL keywords (when not completing after a `.`)
 *  2. In-scope identifiers (params / consts / lambda params)
 *  3. Builtin task names — filtered by namespace prefix when the user
 *     has typed e.g. `shell.` (only `shell.*` tasks appear, with the
 *     `shell.` prefix stripped from the label).
 */

import {
    CompletionItem,
    CompletionItemKind,
} from "vscode-languageserver/node.js";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { Position } from "vscode-languageserver/node.js";
import { getParsed } from "../parsedDocument.js";
import type { TaskSchema } from "../taskSchemas.js";

const DSL_KEYWORDS = [
    "const",
    "step",
    "if",
    "else",
    "switch",
    "case",
    "parallel",
    "import",
    "return",
    "true",
    "false",
    "null",
];

/**
 * Extract a dotted namespace prefix from the text immediately before the
 * cursor.  Returns `""` if the cursor is not inside a member-access
 * context, or `"shell."` if the text before the cursor ends with `shell.`.
 */
function namespacePrefix(doc: TextDocument, pos: Position): string {
    const offset = doc.offsetAt(pos);
    const text = doc.getText();
    // Walk back to find the start of the current token.
    let i = offset - 1;
    while (i >= 0 && /[\w.]/.test(text[i]!)) i--;
    const token = text.slice(i + 1, offset);
    const dot = token.lastIndexOf(".");
    if (dot === -1) return "";
    return token.slice(0, dot + 1); // e.g. "shell."
}

export function computeCompletions(
    doc: TextDocument,
    schemas: TaskSchema[],
    pos?: Position,
): CompletionItem[] {
    const parsed = getParsed(doc);
    const items: CompletionItem[] = [];

    const prefix = pos ? namespacePrefix(doc, pos) : "";
    const hasDot = prefix.length > 0;

    // 1. Keywords — only when not completing after a dot.
    if (!hasDot) {
        for (const kw of DSL_KEYWORDS) {
            items.push({
                label: kw,
                kind: CompletionItemKind.Keyword,
            });
        }
    }

    // 2. In-scope identifiers — only when not completing after a dot.
    if (!hasDot && parsed.symbols) {
        const seen = new Set<string>();
        for (const def of parsed.symbols.defs) {
            if (seen.has(def.name)) continue;
            seen.add(def.name);
            items.push({
                label: def.name,
                kind:
                    def.kind === "param" || def.kind === "lambdaParam"
                        ? CompletionItemKind.Variable
                        : CompletionItemKind.Constant,
                detail:
                    def.kind === "param"
                        ? "parameter"
                        : def.kind === "lambdaParam"
                          ? "lambda parameter"
                          : "constant",
            });
        }
    }

    // 3. Task names — filtered by namespace prefix when present.
    for (const schema of schemas) {
        if (hasDot) {
            if (!schema.name.startsWith(prefix)) continue;
            // Strip the common prefix so the label shows only the local name.
            items.push({
                label: schema.name.slice(prefix.length),
                insertText: schema.name.slice(prefix.length),
                kind: CompletionItemKind.Function,
                detail: "built-in task",
                // Keep the full name in documentation for discoverability.
                documentation: schema.name,
            });
        } else {
            items.push({
                label: schema.name,
                kind: CompletionItemKind.Function,
                detail: "built-in task",
            });
        }
    }

    return items;
}
