// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Pure extraction of a jump target from a captured trace. Given a side and the
 * node the webview asked to open, this reads the source span the trace recorded
 * — the winning grammar rule's location, or the produced action's schema file —
 * and returns the absolute path (plus a range for grammar rules). The host then
 * resolves that path against the side's pinned version to open it; nothing here
 * touches the filesystem or git, so it unit-tests without a workspace.
 */

import type {
    ReplayResolutionTrace,
    GrammarMatchTraceNode,
    ActionTraceNode,
} from "@typeagent/core/replay";
import type { TraceSide, TraceSourceNode } from "./webviewKit/traceProtocol.js";

export interface TraceSourcePosition {
    line: number;
    character: number;
}
export interface TraceSourceRange {
    start: TraceSourcePosition;
    end: TraceSourcePosition;
}

/** Where a jump should land: an absolute path, and (for grammar rules) the exact
 *  span to select. Action jumps carry no range — only the schema file. */
export interface TraceSourceTarget {
    absPath: string;
    range?: TraceSourceRange;
}

/** Resolve the grammar node's `.agr` to an absolute path: the node's recorded
 *  `sourceFilePath` (the real repo file, captured on both sides) when present,
 *  else — for older captures — the winning-rule span's file table (fileId →
 *  resolved path), falling back to the span's display path. */
function grammarAbsolutePath(node: GrammarMatchTraceNode): string | undefined {
    if (node.sourceFilePath !== undefined) {
        return node.sourceFilePath;
    }
    const source = node.source;
    if (source === undefined) {
        return undefined;
    }
    const filePaths = node.debugInfo?.filePaths;
    if (filePaths !== undefined) {
        for (const [id, resolved] of filePaths) {
            if (id === source.fileId) {
                return resolved;
            }
        }
    }
    return source.displayPath;
}

/**
 * The source target for `{side, node}`, or `undefined` when the trace recorded
 * no location (e.g. the grammar produced no winning-rule span, or the action had
 * no schema file). The returned position is 0-based line/character, matching the
 * editor's coordinate space.
 */
export function sourceTargetFor(
    trace: ReplayResolutionTrace,
    side: TraceSide,
    node: TraceSourceNode,
): TraceSourceTarget | undefined {
    const sideTrace = side === "a" ? trace.a : trace.b;
    if (node === "grammar-match") {
        const grammar = sideTrace.nodes.find(
            (n) => n.kind === "grammar-match",
        ) as GrammarMatchTraceNode | undefined;
        if (grammar === undefined) {
            return undefined;
        }
        const absPath = grammarAbsolutePath(grammar);
        if (absPath === undefined) {
            return undefined;
        }
        // The winning-rule span drives the jump-to-line selection; a side that
        // matched no rule (or an older capture) still yields the file path for a
        // cross-version diff, just without a range to select.
        const source = grammar.source;
        return {
            absPath,
            ...(source !== undefined
                ? {
                      range: {
                          start: {
                              line: source.range.start.line,
                              character: source.range.start.character,
                          },
                          end: {
                              line: source.range.end.line,
                              character: source.range.end.character,
                          },
                      },
                  }
                : {}),
        };
    }
    const action = sideTrace.nodes.find((n) => n.kind === "action") as
        | ActionTraceNode
        | undefined;
    const sourceFilePath = action?.schema?.sourceFilePath;
    return sourceFilePath !== undefined
        ? { absPath: sourceFilePath }
        : undefined;
}
