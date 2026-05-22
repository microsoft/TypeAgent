// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Shared helpers for DSL tests. Wrap the parseModule / formatModule
// public APIs to recover the single-workflow ergonomics that tests
// rely on (one workflow per source string, no imports/exports).

import {
    lex,
    Parser,
    formatModule,
    FormatOptions,
    WorkflowDecl,
} from "workflow-dsl";

/**
 * Parse a single-workflow source string. Throws if there are lex or
 * parse errors. Returns the workflow declaration.
 */
export function parseOne(source: string): WorkflowDecl {
    const { tokens, errors: lexErrors, comments } = lex(source);
    if (lexErrors.length > 0) {
        throw new Error(`lex errors: ${JSON.stringify(lexErrors)}`);
    }
    const { module, errors } = new Parser(tokens, comments).parseModule();
    if (errors.length > 0) {
        throw new Error(`parse errors: ${JSON.stringify(errors)}`);
    }
    if (module.workflows.length === 0) {
        throw new Error("no workflow declared in source");
    }
    return module.workflows[0];
}

/**
 * Lex + parseModule, returning errors instead of throwing. For tests
 * that assert on lex/parse error behavior.
 */
export function tryParseOne(source: string): {
    ast: WorkflowDecl | undefined;
    errors: { message: string; line: number; col: number }[];
} {
    const { tokens, errors: lexErrors, comments } = lex(source);
    if (lexErrors.length > 0) {
        return { ast: undefined, errors: lexErrors };
    }
    const { module, errors } = new Parser(tokens, comments).parseModule();
    return { ast: module.workflows[0], errors };
}

/**
 * Format a single workflow declaration back to source text. Wraps
 * formatModule with a minimal Module shell.
 */
export function format(decl: WorkflowDecl, options?: FormatOptions): string {
    return formatModule(
        {
            kind: "Module",
            imports: [],
            workflows: [decl],
            loc: { line: 1, col: 1, offset: 0 },
        },
        options,
    );
}
