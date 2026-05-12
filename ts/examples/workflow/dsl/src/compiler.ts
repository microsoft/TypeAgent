// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Workflow DSL compiler: source text -> WorkflowIR.
 *
 * This is the public API. It orchestrates: lex -> parse -> emit.
 */

import { WorkflowIR } from "workflow-model";
import { lex } from "./lexer.js";
import { Parser } from "./parser.js";
import { Emitter, TaskSchemaInfo } from "./emitter.js";

export interface CompileError {
    phase: "lex" | "parse" | "emit";
    message: string;
    line: number;
    col: number;
}

export interface CompileResult {
    ir?: WorkflowIR | undefined;
    errors: CompileError[];
}

export function compile(
    source: string,
    taskSchemas: TaskSchemaInfo[],
): CompileResult {
    const errors: CompileError[] = [];

    // Lex
    const { tokens, errors: lexErrors } = lex(source);
    for (const e of lexErrors) {
        errors.push({
            phase: "lex",
            message: e.message,
            line: e.line,
            col: e.col,
        });
    }
    if (lexErrors.length > 0) {
        return { errors };
    }

    // Parse
    const parser = new Parser(tokens);
    const { ast, errors: parseErrors } = parser.parse();
    for (const e of parseErrors) {
        errors.push({
            phase: "parse",
            message: e.message,
            line: e.line,
            col: e.col,
        });
    }
    if (!ast || parseErrors.length > 0) {
        return { errors };
    }

    // Emit
    const emitter = new Emitter(taskSchemas);
    const { ir, errors: emitErrors } = emitter.emit(ast);
    for (const e of emitErrors) {
        errors.push({
            phase: "emit",
            message: e.message,
            line: e.line,
            col: e.col,
        });
    }

    return { ir: ir ?? undefined, errors };
}
