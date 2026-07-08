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
          /** Epoch ms the run completed, shown as the "Last run" timestamp. */
          runAt?: number;
          /** The base (A) selection the run used, so a reopened report can
           *  restore its launch controls to the last run. */
          versionA?: ResolvedVersion;
          /** The compare (B) selection the run used, for the same reason. */
          versionB?: ResolvedVersion;
          /** True when the result was pushed from outside the panel (e.g. a
           *  Replay run launched from the Corpora view) rather than from this
           *  panel's own run. The webview accepts it regardless of its own
           *  in-panel request-id sequence so an open report refreshes live. */
          external?: boolean;
      }
    /** A failure for a prior `run` request (or general error). */
    | { type: "error"; requestId?: number; message: string }
    /** Result of a host version QuickPick (omitted message ⇒ user cancelled). */
    | { type: "versionPicked"; side: ReplaySide; resolved: ResolvedVersion }
    /** The utterance filter the user entered in the host input box (empty ⇒
     *  cleared). Only sent when the user confirmed; a cancel sends nothing. */
    | { type: "utteranceSearch"; query: string };

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
          /** The resolved base (A) selection (label/tooltip) to echo back so the
           *  report can restore the launch controls after a close/reopen. */
          resolvedA: ResolvedVersion;
          /** The resolved compare (B) selection, echoed back for the same reason. */
          resolvedB: ResolvedVersion;
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
    | { type: "pickVersion"; side: ReplaySide }
    /** Ask the host to open a native input box to edit the utterance filter,
     *  seeded with the filter currently applied in the report. */
    | { type: "searchUtterances"; current: string };

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

/** A conservative display label for a spec, used when the webview didn't supply
 *  one (the label is display-only; the spec is what actually runs). */
function defaultLabelForSpec(spec: VersionSpec): string {
    return spec.kind === "workingTree" ? "working tree" : spec.ref;
}

/** Rebuild a {@link ResolvedVersion} for echo-back from the webview's untrusted
 *  resolved object, pinned to the already-coerced spec. Only the display
 *  label/tooltip come from the webview (sanitized to strings); the spec is the
 *  host-validated one, so the echoed selection can never diverge from what ran. */
function narrowResolvedVersion(
    value: unknown,
    spec: VersionSpec,
): ResolvedVersion {
    const r = (typeof value === "object" && value !== null ? value : {}) as {
        label?: unknown;
        tooltip?: unknown;
    };
    return {
        spec,
        label:
            typeof r.label === "string" ? r.label : defaultLabelForSpec(spec),
        tooltip: typeof r.tooltip === "string" ? r.tooltip : "",
    };
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
        case "searchUtterances": {
            const current = (value as { current?: unknown }).current;
            return {
                type: "searchUtterances",
                current: typeof current === "string" ? current : "",
            };
        }
        case "run": {
            const m = value as {
                requestId?: unknown;
                agent?: unknown;
                versionA?: unknown;
                versionB?: unknown;
                resolvedA?: unknown;
                resolvedB?: unknown;
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
                const versionA = coerceVersionSpec(m.versionA);
                const versionB = coerceVersionSpec(m.versionB);
                return {
                    type: "run",
                    requestId: m.requestId,
                    agent: m.agent,
                    versionA,
                    versionB,
                    resolvedA: narrowResolvedVersion(m.resolvedA, versionA),
                    resolvedB: narrowResolvedVersion(m.resolvedB, versionB),
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
