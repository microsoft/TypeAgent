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
import type { VersionSpec } from "@typeagent/core/replay";
import {
    coerceVersionSpec,
    type ResolvedVersion,
    type RunProvenance,
} from "./replayViewModel.js";

/** Which launch-control side a version applies to. */
export type ReplaySide = "a" | "b";

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
    | {
          type: "result";
          requestId: number;
          payload: StudioReplayResult;
          /** Resolved identity of both sides, captured at run time. */
          provenance?: RunProvenance;
      }
    /** A failure for a prior `run` request (or general error). */
    | { type: "error"; requestId?: number; message: string }
    /** Result of a host version QuickPick (omitted message ⇒ user cancelled). */
    | { type: "versionPicked"; side: ReplaySide; resolved: ResolvedVersion }
    /** Result of a host agent QuickPick (omitted message ⇒ user cancelled). */
    | { type: "agentPicked"; agent: string };

/** Messages the webview posts to the extension host. */
export type WebviewToHostMessage =
    /** The webview finished loading and is ready to receive `init`. */
    | { type: "ready" }
    /** Request a replay of `agent`'s corpus comparing two versions. */
    | {
          type: "run";
          requestId: number;
          agent: string;
          /** Validated base (A) version spec. */
          versionA: VersionSpec;
          /** Validated compare (B) version spec. */
          versionB: VersionSpec;
      }
    /** Ask the host to open a native version QuickPick for one side. */
    | { type: "pickVersion"; side: ReplaySide }
    /** Ask the host to open a native agent QuickPick. */
    | { type: "pickAgent" }
    /** Re-attempt the service connection. */
    | { type: "reconnect" };

function narrowSide(value: unknown): ReplaySide | undefined {
    return value === "a" || value === "b" ? value : undefined;
}

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
        case "pickAgent":
            return { type: msg.type };
        case "pickVersion": {
            const side = narrowSide((value as { side?: unknown }).side);
            return side ? { type: "pickVersion", side } : undefined;
        }
        case "run": {
            const m = value as {
                requestId?: unknown;
                agent?: unknown;
                versionA?: unknown;
                versionB?: unknown;
            };
            if (
                typeof m.requestId === "number" &&
                Number.isInteger(m.requestId) &&
                m.requestId >= 0 &&
                typeof m.agent === "string"
            ) {
                // Accept either a typed spec (picker selection) or a raw string
                // (legacy text field / test seam); always re-validate host-side
                // rather than trusting the webview's object.
                return {
                    type: "run",
                    requestId: m.requestId,
                    agent: m.agent,
                    versionA: coerceVersionSpec(m.versionA),
                    versionB: coerceVersionSpec(m.versionB),
                };
            }
            return undefined;
        }
        default:
            return undefined;
    }
}
