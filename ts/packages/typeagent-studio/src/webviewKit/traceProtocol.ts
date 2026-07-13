// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The Trace Viewer's own message contract, kept separate from the Impact
 * Report's protocol so the two panels evolve independently. A viewer panel is
 * scoped to a single `{runId, utteranceId}`, so the webview never sends those
 * ids back — it names only a side and a node, and the host rederives the rest
 * from the run descriptor it holds. Every message the webview posts is untrusted
 * input, so {@link parseTraceMessage} narrows it before the host acts on it.
 */

import type { ReplayResolutionTrace } from "@typeagent/core/replay";

/** Which replayed version a webview interaction refers to. */
export type TraceSide = "a" | "b";

/** The node whose source a jump targets. Only these two carry a source span. */
export type TraceSourceNode = "grammar-match" | "action";

/** The live service reachability, mirrored so the viewer shows one indicator. */
export type TraceConnectionState = "disconnected" | "connecting" | "connected";

/** A compact, display-only summary of one pinned version, derived host-side from
 *  the run descriptor for the header's provenance line. */
export interface TraceVersionSummary {
    label: string;
    /** The resolved commit SHA, when the side is a git ref. */
    sha?: string;
    /** True when the side is the live working tree (uncommitted edits). */
    workingTree: boolean;
}

/** The provenance the header shows: the agent and which A/B versions ran. */
export interface TraceProvenanceSummary {
    agent: string;
    a: TraceVersionSummary;
    b: TraceVersionSummary;
    /** Epoch ms the originating run was issued. */
    runAt: number;
}

/** Why a stored trace can't be shown: its run's traces were rotated out
 *  (`evicted`, the report outlived them) or the row was never captured
 *  (`missing`). `loading` is the transient state before the lookup resolves. */
export type TraceUnavailableState = "loading" | "evicted" | "missing";

/** Outcome of a fresh recompute, mirroring the runtime's replay result. */
export type TraceReplayStatus = "recomputed" | "entry-missing" | "unavailable";

/** Outcome of a source jump the host attempted on the webview's behalf. */
export type TraceSourceStatus = "opened" | "unavailable" | "stale";

export type HostToTraceMessage =
    | { type: "connection"; state: TraceConnectionState }
    | {
          type: "trace";
          recorded: ReplayResolutionTrace;
          provenance: TraceProvenanceSummary;
      }
    | { type: "trace-state"; state: TraceUnavailableState }
    | { type: "trace-error"; message: string }
    | {
          type: "replay-result";
          requestId: number;
          status: TraceReplayStatus;
          fresh?: ReplayResolutionTrace;
          message?: string;
      }
    | {
          type: "source-result";
          requestId: number;
          status: TraceSourceStatus;
          message?: string;
      };

export type TraceToHostMessage =
    | { type: "ready" }
    | { type: "replay"; requestId: number }
    | {
          type: "open-source";
          requestId: number;
          side: TraceSide;
          node: TraceSourceNode;
      };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isSide(value: unknown): value is TraceSide {
    return value === "a" || value === "b";
}

function isSourceNode(value: unknown): value is TraceSourceNode {
    return value === "grammar-match" || value === "action";
}

/**
 * Narrow an untrusted webview message to a known {@link TraceToHostMessage}, or
 * `undefined` when it doesn't match any known shape. Only the fields the host
 * uses are validated; ids the panel already owns (runId/utteranceId) are never
 * accepted from the webview.
 */
export function parseTraceMessage(
    value: unknown,
): TraceToHostMessage | undefined {
    if (!isRecord(value) || typeof value.type !== "string") {
        return undefined;
    }
    switch (value.type) {
        case "ready":
            return { type: "ready" };
        case "replay":
            return typeof value.requestId === "number"
                ? { type: "replay", requestId: value.requestId }
                : undefined;
        case "open-source":
            return typeof value.requestId === "number" &&
                isSide(value.side) &&
                isSourceNode(value.node)
                ? {
                      type: "open-source",
                      requestId: value.requestId,
                      side: value.side,
                      node: value.node,
                  }
                : undefined;
        default:
            return undefined;
    }
}
