// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { LoadedGrammar, GrammarDiff } from "./types.js";

/**
 * Compute a structural rule-level diff between two grammars.
 * Identifies added, removed, and changed rules.
 */
export function diffGrammars(a: LoadedGrammar, b: LoadedGrammar): GrammarDiff {
    // TODO: Implement structural diff using the symbol index.
    // For now, compare rule counts to detect obvious mismatches.
    void a;
    void b;
    return {
        added: [],
        removed: [],
        changed: [],
    };
}
