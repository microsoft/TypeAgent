// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { LoadedGrammar, Diagnostic } from "./types.js";
import { MissingSourceError } from "./types.js";

/**
 * Run diagnostics on a loaded grammar.
 * Requires source files (throws MissingSourceError otherwise).
 */
export function getDiagnostics(g: LoadedGrammar): Diagnostic[] {
    if (!g.files || g.files.length === 0) {
        throw new MissingSourceError(g.source);
    }

    // TODO: Implement semantic analysis (duplicate rules, unreachable
    // alternatives, shadowed wildcards, etc.)
    return [];
}
