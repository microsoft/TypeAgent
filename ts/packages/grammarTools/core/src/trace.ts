// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { LoadedGrammar, MatchTrace } from "./types.js";

/**
 * Run the grammar matcher with tracing enabled and return the full
 * event stream. Requires chunk 02 trace hook to be implemented in
 * actionGrammar.
 */
export function traceMatch(g: LoadedGrammar, input: string): MatchTrace {
    // TODO: Once chunk 02 lands the trace callback in grammarMatcher,
    // wire it here: call matchGrammar with the trace hook enabled,
    // collect TraceEvents, and return the MatchTrace.
    void g;
    return {
        input,
        events: [],
        result: "noMatch",
    };
}
