// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Custom LSP request handler for the IR preview command.
 *
 * The VS Code extension issues `workflow/compileIR` with a document
 * URI; the server runs the DSL compiler against the current text plus
 * the builtin task schemas and returns either the IR JSON or the
 * compile error list. Keeping the compile work server-side avoids
 * pulling `workflow-dsl` into the extension bundle.
 */

import { TextDocuments } from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import { compile } from "workflow-dsl";
import type { TaskSchema } from "../taskSchemas.js";

export interface CompileIRParams {
    uri: string;
}

export interface CompileIRResult {
    ir?: unknown;
    errors: {
        phase: string;
        message: string;
        line: number;
        col: number;
    }[];
}

export function compileIR(
    documents: TextDocuments<TextDocument>,
    params: CompileIRParams,
    schemas: TaskSchema[],
): CompileIRResult {
    const doc = documents.get(params.uri);
    if (!doc) {
        return {
            errors: [
                {
                    phase: "validate",
                    message: `unknown document: ${params.uri}`,
                    line: 1,
                    col: 1,
                },
            ],
        };
    }
    const result = compile(doc.getText(), schemas);
    return {
        ir: result.ir,
        errors: result.errors.map((e) => ({
            phase: e.phase,
            message: e.message,
            line: e.line,
            col: e.col,
        })),
    };
}
