// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Custom LSP request handler for the workflow graph preview.
 *
 * The VS Code extension (and any other LSP-capable client) issues
 * `workflow/previewGraph` with a document URI; the server lexes and
 * parses the current text and returns either the {@link GraphModel}
 * produced by `extractGraph()` or the lex/parse error list. The graph
 * is intentionally returned untyped — `extractGraph()` operates on the
 * parsed AST without requiring a clean typecheck, so a graph is still
 * available when there are typecheck errors elsewhere in the file.
 *
 * The return shape mirrors {@link CompileIRResult} so editors can use
 * the same error rendering for both previews.
 */

import { TextDocuments } from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import { lex, Parser, extractGraph, type GraphModel } from "workflow-dsl";

export interface PreviewGraphParams {
    uri: string;
}

export interface PreviewGraphResult {
    graph?: GraphModel;
    errors: {
        phase: string;
        message: string;
        line: number;
        col: number;
    }[];
}

export function previewGraph(
    documents: TextDocuments<TextDocument>,
    params: PreviewGraphParams,
): PreviewGraphResult {
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

    const { tokens, errors: lexErrors, comments } = lex(doc.getText());
    if (lexErrors.length > 0) {
        return {
            errors: lexErrors.map((e) => ({
                phase: "lex",
                message: e.message,
                line: e.line,
                col: e.col,
            })),
        };
    }

    const parser = new Parser(tokens, comments);
    const { ast, errors: parseErrors } = parser.parseSingle();
    if (!ast) {
        return {
            errors: parseErrors.map((e) => ({
                phase: "parse",
                message: e.message,
                line: e.line,
                col: e.col,
            })),
        };
    }

    return {
        graph: extractGraph(ast),
        // Parse errors that did not prevent recovery still surface, so
        // the client can show squiggle-equivalents alongside the graph.
        errors: parseErrors.map((e) => ({
            phase: "parse",
            message: e.message,
            line: e.line,
            col: e.col,
        })),
    };
}
