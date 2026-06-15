// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { TraceEvent } from "@typeagent/action-grammar";
import type { GrammarDebugInfo, MatchTrace, SourceLocation } from "./types.js";

export interface FormatTraceOptions {
    /** Include the input string and result summary header. Default: true. */
    header?: boolean;
    /** Show seq numbers on each line. Default: false. */
    showSeq?: boolean;
    /** Show input position annotations. Default: true. */
    showPos?: boolean;
    /** Max width for input excerpts. Default: 20. */
    excerptWidth?: number;
    /** Debug info for resolving partId/rule to source locations. */
    debugInfo?: GrammarDebugInfo | undefined;
    /**
     * Append source locations to part and rule events.
     * Default: true when `debugInfo` is provided, false otherwise.
     */
    showSourceLocations?: boolean;
}

/**
 * Format a MatchTrace into a human-readable indented string suitable
 * for terminal output or a debug panel.
 */
export function formatTrace(
    trace: MatchTrace,
    options?: FormatTraceOptions,
): string {
    const showHeader = options?.header ?? true;
    const showSeq = options?.showSeq ?? false;
    const showPos = options?.showPos ?? true;
    const excerptWidth = options?.excerptWidth ?? 20;
    const debugInfo = options?.debugInfo;
    const showSourceLocations =
        options?.showSourceLocations ?? debugInfo !== undefined;

    const lines: string[] = [];
    if (showHeader) {
        lines.push(`input: ${JSON.stringify(trace.input)}`);
        lines.push(`result: ${trace.result}`);
        lines.push("");
    }

    // Use the depth field from ruleEntered events as ground truth.
    // Maintain a stack of rule depths. On ruleEntered, trim stale entries
    // from aborted rules (those with depth >= the new entry) then push.
    const depthStack: number[] = [];
    // Track the inputPos from the last partAttempted so we can show
    // the matched span (from attempt start to match end).
    let lastAttemptPos = 0;
    for (const event of trace.events) {
        if (event.kind === "partAttempted") {
            lastAttemptPos = event.inputPos;
        }
        let renderDepth: number;
        if (event.kind === "ruleEntered") {
            // Trim entries from rules that were aborted without ruleExited
            while (
                depthStack.length > 0 &&
                depthStack[depthStack.length - 1] >= event.depth
            ) {
                depthStack.pop();
            }
            depthStack.push(event.depth);
            renderDepth = event.depth;
        } else if (event.kind === "ruleExited") {
            renderDepth = depthStack.pop() ?? 0;
        } else {
            // Parts and backtracks render one level inside the current rule
            const top = depthStack[depthStack.length - 1] ?? 0;
            renderDepth = top + 1;
        }
        lines.push(
            formatEvent(event, trace.input, renderDepth, lastAttemptPos, {
                showSeq,
                showPos,
                excerptWidth,
                debugInfo: showSourceLocations ? debugInfo : undefined,
            }),
        );
    }

    return lines.join("\n");
}

function formatEvent(
    event: TraceEvent,
    input: string,
    depth: number,
    lastAttemptPos: number,
    opts: {
        showSeq: boolean;
        showPos: boolean;
        excerptWidth: number;
        debugInfo: GrammarDebugInfo | undefined;
    },
): string {
    const indent = "  ".repeat(depth);
    const pos = opts.showPos ? ` @${event.inputPos}` : "";
    const seq = opts.showSeq ? `[${event.seq}] ` : "";
    const dbg = opts.debugInfo;

    switch (event.kind) {
        case "ruleEntered": {
            const src = dbg ? locStr(dbg.rules.get(event.rule)) : "";
            return `${seq}${indent}\u25b6 ${event.rule}${pos}${src}`;
        }
        case "ruleExited": {
            const icon = event.result === "matched" ? "\u2713" : "\u2717";
            return `${seq}${indent}${icon} ${event.rule} ${event.result}${pos}`;
        }
        case "partAttempted": {
            const label = dbg?.partLabels.get(event.part);
            const partName = label ?? `${event.partKind}[${event.part}]`;
            const src = dbg ? locStr(dbg.parts.get(event.part)) : "";
            return `${seq}${indent}  \u251c try ${partName}${pos}${src}`;
        }
        case "partMatched": {
            const span = excerpt(
                input,
                lastAttemptPos,
                event.endPos,
                opts.excerptWidth,
            );
            const spanStr = span ? ` ${JSON.stringify(span)}` : "";
            const label = opts.debugInfo?.partLabels.get(event.part);
            const partName = label ?? `[${event.part}]`;
            const capStr = event.capturedValue
                ? ` $${event.capturedValue.variable}=${JSON.stringify(event.capturedValue.value)}`
                : "";
            return `${seq}${indent}  \u2502 matched ${partName} @${lastAttemptPos}..${event.endPos}${spanStr}${capStr}`;
        }
        case "partFailed": {
            const label = opts.debugInfo?.partLabels.get(event.part);
            const partName = label ?? `[${event.part}]`;
            return `${seq}${indent}  \u2502 failed ${partName}${pos}`;
        }
        case "backtrack":
            return `${seq}${indent}\u21b6 backtrack (${event.origin})${pos}`;
    }
}

function excerpt(
    input: string,
    start: number,
    end: number,
    maxWidth: number,
): string {
    // For partMatched, show what was consumed between the previous
    // position and endPos. The event's inputPos is actually the
    // position *after* matching (state.index), so the matched span
    // is from some earlier point to endPos. We'll just show the text
    // around the end position for context.
    if (start === end) return "";
    const slice = input.slice(start, end);
    if (slice.length <= maxWidth) return slice;
    return slice.slice(0, maxWidth - 1) + "\u2026";
}

/**
 * Format a SourceLocation as a short " (file:line:col)" suffix.
 * Returns empty string when loc is undefined.
 */
function locStr(loc: SourceLocation | undefined): string {
    if (!loc) return "";
    const line = loc.range.start.line + 1; // 0-based → 1-based
    const col = loc.range.start.character + 1;
    return ` (${loc.displayPath}:${line}:${col})`;
}
