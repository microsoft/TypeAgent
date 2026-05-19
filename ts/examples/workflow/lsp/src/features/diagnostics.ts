// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Diagnostics feature: run `compile()` against the document and
 * surface lex/parse/typecheck/emit errors via
 * `textDocument/publishDiagnostics`.
 *
 * Notes on range fidelity:
 *   `CompileError` only carries a start `line` / `col`. We synthesize
 *   a small range at that position (`pointRange`). Phase 2+ can widen
 *   the range once we propagate token spans through the compiler.
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
        range: pointRange({ line: err.line, col: err.col }),
        message: err.message,
        source: "workflow",
        code: err.phase,
    };
}
