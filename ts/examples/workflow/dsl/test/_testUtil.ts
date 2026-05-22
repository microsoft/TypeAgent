// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Shared helpers for DSL tests. Wraps the module-level formatter so
// per-workflow tests can keep their single-workflow ergonomics.

import { formatModule, FormatOptions, WorkflowDecl } from "workflow-dsl";

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
