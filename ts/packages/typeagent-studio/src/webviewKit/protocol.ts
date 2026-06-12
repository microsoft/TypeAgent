// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Typed message envelope for the host (extension) ↔ webview (iframe) channel.
 *
 * Pure data types only — no `vscode` or DOM dependency — so both the extension
 * host bundle and the browser client bundle import them, and they're unit
 * testable. The host turns a webview `run` into a `studio`-agent action call
 * over the service channel and posts the typed result back; the webview never
 * touches a socket (the security boundary).
 */

import type { StudioReplayResult } from "@typeagent/core/runtime";

/** Messages the extension host posts to the webview. */
export type HostToWebviewMessage =
    /** Initial (or restored) state + connection on load. */
    | {
          type: "init";
          /** Corpus agents available to replay (channel `listCorpusAgents`). */
          agents: string[];
          /** Whether the studio service channel is reachable. */
          connected: boolean;
      }
    /** A connection/loading status line for the webview to surface. */
    | { type: "status"; text: string }
    /** A completed replay result for a prior `run` request. */
    | { type: "result"; requestId: number; payload: StudioReplayResult }
    /** A failure for a prior `run` request (or general error). */
    | { type: "error"; requestId?: number; message: string };

/** Messages the webview posts to the extension host. */
export type WebviewToHostMessage =
    /** The webview finished loading and is ready to receive `init`. */
    | { type: "ready" }
    /** Request a replay of `agent`'s corpus (deterministic policy). */
    | { type: "run"; requestId: number; agent: string }
    /** Re-attempt the service connection. */
    | { type: "reconnect" };

/** Narrow an untrusted value into a {@link WebviewToHostMessage}. */
export function parseWebviewMessage(
    value: unknown,
): WebviewToHostMessage | undefined {
    if (typeof value !== "object" || value === null) {
        return undefined;
    }
    const msg = value as { type?: unknown };
    switch (msg.type) {
        case "ready":
        case "reconnect":
            return { type: msg.type };
        case "run": {
            const m = value as { requestId?: unknown; agent?: unknown };
            if (typeof m.requestId === "number" && typeof m.agent === "string") {
                return { type: "run", requestId: m.requestId, agent: m.agent };
            }
            return undefined;
        }
        default:
            return undefined;
    }
}
