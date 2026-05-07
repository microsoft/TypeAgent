// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { matchGrammar } from "action-grammar";
import type { TraceCallback, TraceEvent } from "action-grammar";
import type { LoadedGrammar, MatchTrace } from "./types.js";

/**
 * Run the grammar matcher with tracing enabled and return the full
 * event stream.
 */
export function traceMatch(g: LoadedGrammar, input: string): MatchTrace {
    const events: TraceEvent[] = [];
    const trace: TraceCallback = (event) => {
        events.push(event);
    };
    const results = matchGrammar(g.grammar, input, { trace });
    return {
        input,
        events,
        result: results.length > 0 ? "matched" : "noMatch",
    };
}
