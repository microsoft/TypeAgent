// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The bridge between the Trace Viewer render modules and its VS Code host: owns
 * the `acquireVsCodeApi` handle and the source open/compare lifecycle (the
 * monotonic request id and the transient "couldn't open that file" note). The
 * render helpers post through {@link requestSource} / {@link requestCompare}
 * without touching the messaging plumbing, and the entry module reads
 * {@link getSourceNote} to surface the last note. A rerender callback registered
 * with {@link setRerender} lets a click-driven request refresh the view.
 */

import type {
    HostToTraceMessage,
    TraceToHostMessage,
    TraceSide,
    TraceSourceNode,
} from "../traceProtocol.js";

interface VsCodeApi {
    postMessage(message: TraceToHostMessage): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

// Monotonic id for source open/compare requests so a stale reply is ignored.
let sourceRequestId = 0;

// Transient feedback from the last source open/compare (e.g. a file that can't
// be located); cleared when the row changes or a jump succeeds.
let sourceNote: string | undefined;

// The view refresh a click-driven request triggers so cleared feedback shows.
let rerender: () => void = () => {};

type SourceResultMessage = Extract<
    HostToTraceMessage,
    { type: "source-result" }
>;

/** Register the function that repaints the view; called by request helpers so a
 *  click that clears the source note re-renders without the caller wiring it. */
export function setRerender(fn: () => void): void {
    rerender = fn;
}

/** The last unresolved source open/compare note, shown as a banner by the entry;
 *  undefined when the last request succeeded or none is pending. */
export function getSourceNote(): string | undefined {
    return sourceNote;
}

/** Drop any pending source note — used when a new row arrives so a previous
 *  row's open error doesn't bleed into it. */
export function clearSourceNote(): void {
    sourceNote = undefined;
}

/** Tell the host the client is ready to receive a trace. */
export function postReady(): void {
    vscode.postMessage({ type: "ready" });
}

/** Post a source-jump request for one node on one side; the host opens that
 *  side's version of the backing file, scrolled to the recorded span. */
export function requestSource(side: TraceSide, node: TraceSourceNode): void {
    sourceRequestId += 1;
    sourceNote = undefined;
    rerender();
    vscode.postMessage({
        type: "open-source",
        requestId: sourceRequestId,
        side,
        node,
    });
}

/** Post a compare request: the host opens a native A↔B diff of the node's file. */
export function requestCompare(node: TraceSourceNode): void {
    sourceRequestId += 1;
    sourceNote = undefined;
    rerender();
    vscode.postMessage({
        type: "compare-source",
        requestId: sourceRequestId,
        node,
    });
}

/** Fold a source-result reply into the note state, ignoring a stale reply
 *  superseded by a newer request. A successful open cleared the view, so any
 *  stale note is dropped; a failure surfaces the host's explanation. */
export function applySourceResult(msg: SourceResultMessage): void {
    if (msg.requestId !== sourceRequestId) {
        return;
    }
    if (msg.status === "opened") {
        sourceNote = undefined;
    } else if (msg.message !== undefined) {
        sourceNote = msg.message;
    }
}
