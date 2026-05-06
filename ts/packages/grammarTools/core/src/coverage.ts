// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { LoadedGrammar, CoverageReport } from "./types.js";

/**
 * Run a corpus of inputs against a grammar and produce per-rule / per-part
 * hit counts. Requires chunk 02 trace hook for per-part granularity.
 */
export function runCoverage(
    g: LoadedGrammar,
    corpus: Iterable<string>,
): CoverageReport {
    // TODO: Implement once trace hook (chunk 02) and GrammarDebugInfo
    // (A.5) land. For now, return an empty report.
    const inputs = Array.from(corpus);
    void g;
    return {
        grammarHash: "",
        totals: { rules: 0, parts: 0, ruleHits: 0, partHits: 0 },
        perRule: [],
        unmatchedInputs: inputs.map((input) => ({ input })),
    };
}
