// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Diagnostics feature: run `compile()` against the document and
 * surface lex/parse/typecheck/emit errors via
 * `textDocument/publishDiagnostics`.
 *
 * `CompileError` now carries both a start position and a `length` so
 * each diagnostic squiggle covers the real token span.
 */

import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver/node.js";
import { compile, type CompileError } from "workflow-dsl";
import type { TaskSchema } from "../taskSchemas.js";
import { pointRange } from "../util/position.js";

export function computeDiagnostics(
    text: string,
    schemas: TaskSchema[],
): Diagnostic[] {
    const result = compile(text, schemas);
    return result.errors.map(toDiagnostic);
}

function toDiagnostic(err: CompileError): Diagnostic {
    return {
        severity: DiagnosticSeverity.Error,
        range: pointRange({ line: err.line, col: err.col }, err.length),
        message: err.message,
        source: "workflow",
        code: err.phase,
    };
}
