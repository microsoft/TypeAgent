// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Capture helpers that turn a live grammar match into the serializable trace
 * nodes the Trace Viewer renders. These sit beside the grammar resolver: the
 * resolver decides *what* action a side produced, and these functions record
 * the step-by-step *why* by re-running the same grammar through
 * `grammar-tools-core`'s tracing matcher and mapping the event stream back to
 * `.agr` source spans.
 */

import {
    loadGrammarFromBuffer,
    traceMatch,
    type FileLoader,
    type SourceLocation,
    type TraceEvent,
} from "grammar-tools-core";
import { actionsEqual } from "./engine.js";
import { normalizeAction } from "./replayActionShape.js";
import {
    serializeGrammarDebugInfo,
    type GrammarMatchTraceNode,
} from "./resolutionTrace.js";

/**
 * Build the grammar-match trace node for one side. Loads the grammar text
 * through `grammar-tools-core` (so its compile-time debug info maps parts/rules
 * to source spans), runs the tracing matcher over the utterance, and records the
 * event stream, the serialized debug info, a headline source span, and whether
 * the traced parse agreed with the resolver's ranked pick.
 *
 * @param schemaName   Schema stamped onto actions, used to normalize the traced
 *                     value before comparing it to the resolver's chosen action.
 * @param grammarFileName Identity used as the grammar's file id (drives the
 *                     `displayPath` on resolved spans).
 * @param grammarText  The `.agr` source read at this side's version.
 * @param utterance    The utterance being resolved.
 * @param chosenAction The action the resolver's ranked match settled on
 *                     (already normalized), or `undefined` when it produced no
 *                     action. Drives outcome and ranking parity.
 * @param fileLoader   Resolves `import ... from "./other.agr"` statements in the
 *                     grammar text. Supply one that reads sibling grammars at the
 *                     same version so imported spans resolve; omit for a
 *                     self-contained grammar.
 * @param grammarFilePath Absolute path of the `.agr` file the text was read from,
 *                     recorded on the node so the viewer can open and diff the
 *                     exact file across versions. Omit when no file backs the text.
 */
export function captureGrammarMatchTrace(
    schemaName: string,
    grammarFileName: string,
    grammarText: string,
    utterance: string,
    chosenAction: unknown,
    fileLoader?: FileLoader,
    grammarFilePath?: string,
): GrammarMatchTraceNode {
    const outcome = chosenAction !== undefined ? "hit" : "miss";
    const base: GrammarMatchTraceNode = {
        kind: "grammar-match",
        execution: "ran",
        outcome,
        input: utterance,
        rankingParity: "unavailable",
        ...(grammarFilePath !== undefined
            ? { sourceFilePath: grammarFilePath }
            : {}),
    };

    let loaded;
    try {
        loaded = loadGrammarFromBuffer(
            grammarFileName,
            grammarText,
            fileLoader,
        );
    } catch (err) {
        return { ...base, detail: `trace unavailable: ${message(err)}` };
    }
    if (!loaded.ok) {
        const first = loaded.diagnostics[0]?.message ?? "grammar load failed";
        return { ...base, detail: `trace unavailable: ${first}` };
    }

    const { debugInfo } = loaded.grammar;
    if (debugInfo === undefined) {
        return { ...base, detail: "trace unavailable: no debug info" };
    }

    const trace = traceMatch(loaded.grammar, utterance);
    const tracedAction = normalizeAction(schemaName, trace.matchValue);
    const rankingParity: GrammarMatchTraceNode["rankingParity"] =
        chosenAction === undefined
            ? "unavailable"
            : actionsEqual(tracedAction, chosenAction)
              ? "matched"
              : "diverged";

    const anchor = headlineSpan(trace.events, debugInfo);

    return {
        ...base,
        trace,
        debugInfo: serializeGrammarDebugInfo(debugInfo),
        rankingParity,
        ...(anchor?.rule !== undefined ? { chosenRule: anchor.rule } : {}),
        ...(anchor?.source !== undefined ? { source: anchor.source } : {}),
    };
}

/**
 * Pick a single source span to anchor the viewer's "jump to the winning line"
 * action. The last `partMatched` event lies on the accepted parse (matching
 * completes left-to-right and the final token is matched last), so its part's
 * span points at the concrete `.agr` line the match landed on; its owning rule
 * is the headline rule. Falls back to nothing when no part with a known span was
 * matched (e.g. a match made entirely of spanless synthetic parts).
 */
function headlineSpan(
    events: readonly TraceEvent[],
    debugInfo: {
        parts: ReadonlyMap<number, SourceLocation>;
        partRules: ReadonlyMap<number, string>;
    },
): { rule?: string; source?: SourceLocation } | undefined {
    for (let i = events.length - 1; i >= 0; i--) {
        const event = events[i];
        if (event.kind !== "partMatched") {
            continue;
        }
        const source = debugInfo.parts.get(event.part);
        if (source === undefined) {
            continue;
        }
        const rule = debugInfo.partRules.get(event.part);
        return { source, ...(rule !== undefined ? { rule } : {}) };
    }
    return undefined;
}

function message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
