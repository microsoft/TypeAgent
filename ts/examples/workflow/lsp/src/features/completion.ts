// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Completion feature.
 *
 * Phase 2 scope: identifier completion. We surface
 *  - in-scope DSL names (params / consts / lambda params visible at
 *    the cursor), and
 *  - builtin task names.
 *
 * This is intentionally simple (no AST-driven context filtering): a
 * future revision can suppress task names inside argument positions
 * where they wouldn't fit, and prefer dotted-name completion when the
 * user has typed a dot. The bar for Phase 2 is "the names exist;
 * the list is meaningful".
 */

import {
    CompletionItem,
    CompletionItemKind,
} from "vscode-languageserver/node.js";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { getParsed } from "../parsedDocument.js";
import type { TaskSchema } from "../taskSchemas.js";

export function computeCompletions(
    doc: TextDocument,
    schemas: TaskSchema[],
): CompletionItem[] {
    const parsed = getParsed(doc);
    const items: CompletionItem[] = [];

    if (parsed.symbols) {
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

    for (const schema of schemas) {
        items.push({
            label: schema.name,
            kind: CompletionItemKind.Function,
            detail: "built-in task",
        });
    }

    return items;
}
