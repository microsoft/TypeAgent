// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Hover feature.
 *
 * Triggered by `textDocument/hover`. Resolves the identifier under
 * the cursor to either:
 *  - a bound symbol (param / const / lambda param) with its declaring
 *    snippet, or
 *  - a builtin task name with its input/output schema summary.
 *
 * Returns `null` (no hover) when the cursor is over whitespace, a
 * literal, or a name we can't resolve.
 */

import { Hover, MarkupKind } from "vscode-languageserver/node.js";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { TypeChecker, formatType } from "workflow-dsl";
import { getParsed } from "../parsedDocument.js";
import { fromLspPosition } from "../util/position.js";
import {
    findReferenceAt,
    findTaskReferenceAt,
    findDefinitionAt,
    type SymbolDef,
} from "../symbolResolver.js";
import type { TaskSchema } from "../taskSchemas.js";

export function computeHover(
    doc: TextDocument,
    position: { line: number; character: number },
    schemas: TaskSchema[],
): Hover | null {
    const parsed = getParsed(doc);
    if (parsed.workflows.length === 0) return null;

    const { line, col } = fromLspPosition(position);

    const taskRef = findTaskReferenceAt(parsed.symbols, line, col);
    if (taskRef) {
        const schema = schemas.find((s) => s.name === taskRef.name);
        if (schema) return taskHover(schema);
        return null;
    }

    const ref = findReferenceAt(parsed.symbols, line, col);
    const def = ref?.def ?? findDefinitionAt(parsed.symbols, line, col);
    if (!def) return null;

    // Look up the inferred type via a single multi-workflow pass.
    // The merged map is keyed by file-wide unique source offset, so
    // the workflow boundary doesn't matter.
    let typeLabel: string | undefined;
    const symbolTypes = new TypeChecker(schemas).collectSymbolTypes(
        parsed.workflows.map((w) => w.decl),
    );
    const info = symbolTypes.get(def.loc.offset);
    if (info && info.kind !== "unresolved") {
        typeLabel = formatType(info);
    }

    return symbolHover(def, typeLabel);
}

function symbolHover(def: SymbolDef, typeLabel?: string): Hover {
    let declaration: string;
    if (def.kind === "param") {
        declaration = typeLabel
            ? `(parameter) ${def.name}: ${typeLabel}`
            : `(parameter) ${def.name}`;
    } else if (def.kind === "lambdaParam") {
        declaration = typeLabel
            ? `(parameter) ${def.name}: ${typeLabel}`
            : `(parameter) ${def.name}`;
    } else {
        // const binding
        declaration = typeLabel
            ? `const ${def.name}: ${typeLabel}`
            : `const ${def.name}`;
    }
    return {
        contents: {
            kind: MarkupKind.Markdown,
            value: `\`\`\`workflow\n${declaration}\n\`\`\``,
        },
    };
}

function taskHover(schema: TaskSchema): Hover {
    const lines: string[] = [];
    lines.push(`**${schema.name}** &mdash; built-in task`);
    lines.push("");
    lines.push("```json");
    lines.push("input: " + JSON.stringify(schema.inputSchema));
    lines.push("output: " + JSON.stringify(schema.outputSchema));
    lines.push("```");
    return {
        contents: { kind: MarkupKind.Markdown, value: lines.join("\n") },
    };
}
