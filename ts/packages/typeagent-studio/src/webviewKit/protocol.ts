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

import type {
    StudioReplayResult,
    StudioReplayMode,
} from "@typeagent/core/runtime";
import type { VersionSpec } from "@typeagent/core/replay";
import {
    coerceVersionSpec,
    type ResolvedVersion,
    type RunProvenance,
} from "./replayViewModel.js";

/** Which launch-control side a version applies to. */
export type ReplaySide = "a" | "b";

/** Shared service connection state mirrored to the webview. Declared here (not
 *  imported from the node-only connection module) so the browser bundle stays
 *  free of node/ws; the values match `StudioConnectionState`. */
export type ConnectionState = "disconnected" | "connecting" | "connected";

/** Messages the extension host posts to the webview. */
export type HostToWebviewMessage =
    /** Initial (or restored) state + connection on load. */
    | {
          type: "init";
          /** The agent this report is scoped to (fixed at panel open). */
          agent: string;
          /** Whether the studio service channel is reachable. */
          connected: boolean;
          /** Whether `agent` has a corpus available to replay (channel
           *  `listCorpusAgents`). */
          available: boolean;
          /** Whether wildcard validation can run for `agent` — it exposes a
           *  `validateWildcardMatch` and its module loads. Drives the validation
           *  toggle: enabled when there is a validator to run, disabled (a no-op)
           *  otherwise. */
          canValidateWildcards: boolean;
      }
    /** A connection/loading status line for the webview to surface. */
    | { type: "status"; text: string }
    /** The shared service connection state, so the webview can show a single
     *  connection indicator and reflect auto-reconnect (no manual button). */
    | { type: "connection"; state: ConnectionState }
    /** A completed replay result for a prior `run` request. */
    | {
          type: "result";
          requestId: number;
          payload: StudioReplayResult;
          /** Resolved identity of both sides, captured at run time. */
          provenance?: RunProvenance;
          /** True when this is a cached run restored on (re)open rather than a
           *  fresh live run, so the webview can label it as such. */
          restored?: boolean;
          /** Epoch ms the restored run originally completed, for the label. */
          runAt?: number;
      }
    /** A failure for a prior `run` request (or general error). */
    | { type: "error"; requestId?: number; message: string }
    /** Result of a host version QuickPick (omitted message ⇒ user cancelled). */
    | { type: "versionPicked"; side: ReplaySide; resolved: ResolvedVersion };

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
          /** Which deterministic dispatch path to model. */
          mode: StudioReplayMode;
          /**
           * Opt-in: additionally run the agent's real `validateWildcardMatch`
           * over the working-tree side's wildcard matches. Off unless the user
           * lit the validation toggle.
           */
          validateWildcards: boolean;
      }
    /** Ask the host to open a native version QuickPick for one side. */
    | { type: "pickVersion"; side: ReplaySide };

function narrowSide(value: unknown): ReplaySide | undefined {
    return value === "a" || value === "b" ? value : undefined;
}

/**
 * Narrow an untrusted mode into a {@link StudioReplayMode}, defaulting unknown
 * or missing values to the grammar-only `nfa-grammar` baseline (the safer,
 * cache-free default the runtime also falls back to).
 */
function narrowMode(value: unknown): StudioReplayMode {
    return value === "completionBased-cache" ? value : "nfa-grammar";
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
                mode?: unknown;
                validateWildcards?: unknown;
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
                    mode: narrowMode(m.mode),
                    // Opt-in and conservative: only an explicit `true` enables it.
                    validateWildcards: m.validateWildcards === true,
                };
            }
            return undefined;
        }
        default:
            return undefined;
    }
}
