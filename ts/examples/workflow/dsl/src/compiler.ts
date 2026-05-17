// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Workflow DSL compiler: source text -> WorkflowIR.
 *
 * This is the public API. It orchestrates: lex -> parse -> emit.
 */

import { WorkflowIR, validateWorkflowIR } from "workflow-model";
import { lex } from "./lexer.js";
import { Parser } from "./parser.js";
import { TypeChecker } from "./typeChecker.js";
import { Emitter, TaskSchemaInfo } from "./emitter.js";

export interface CompileError {
    phase: "lex" | "parse" | "typecheck" | "emit" | "validate";
    message: string;
    line: number;
    col: number;
}

export interface CompileOptions {
    /** Run IR validation after emit. Defaults to false. */
    validate?: boolean;
}

export interface CompileResult {
    ir?: WorkflowIR | undefined;
    errors: CompileError[];
}

export function compile(
    source: string,
    taskSchemas: TaskSchemaInfo[],
    options?: CompileOptions,
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
    const { ast, errors: parseErrors } = parser.parseSingle();
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

    // Type check
    const checker = new TypeChecker(taskSchemas);
    const typeErrors = checker.check(ast);
    for (const e of typeErrors) {
        errors.push({
            phase: "typecheck",
            message: e.message,
            line: e.line,
            col: e.col,
        });
    }
    if (typeErrors.length > 0) {
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

    maybeValidate(ir ?? null, errors, options);

    return { ir: ir ?? undefined, errors };
}

function maybeValidate(
    ir: WorkflowIR | null,
    errors: CompileError[],
    options?: CompileOptions,
): void {
    if (!options?.validate || !ir || errors.length > 0) return;
    const result = validateWorkflowIR(ir);
    for (const e of result.errors) {
        errors.push({
            phase: "validate",
            message: `${e.path}: ${e.message}`,
            line: 0,
            col: 0,
        });
    }
}
