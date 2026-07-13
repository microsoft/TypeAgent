// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { WebviewKitPanel } from "./webviewKit/host.js";
import {
    parseTraceMessage,
    type HostToTraceMessage,
    type TraceProvenanceSummary,
    type TraceVersionSummary,
} from "./webviewKit/traceProtocol.js";
import type { ImpactReportConnection } from "./impactReportView.js";
import { StudioServiceClient } from "./studioServiceClient.js";
import type { StudioConnectionState } from "./studioServiceConnection.js";
import { loadResolutionTrace, loadTraceRun } from "./traceStore.js";
import type {
    ReplayRunDescriptor,
    TraceVersionPin,
} from "@typeagent/core/replay";

const VIEW_TYPE = "typeagentStudio.traceViewer";

/** The panel title truncates the utterance to keep the tab readable. */
const TITLE_UTTERANCE_MAX = 40;

function toVersionSummary(pin: TraceVersionPin): TraceVersionSummary {
    return {
        label: pin.label,
        workingTree: pin.workingTree,
        ...(pin.sha !== undefined ? { sha: pin.sha } : {}),
    };
}

function toProvenance(descriptor: ReplayRunDescriptor): TraceProvenanceSummary {
    return {
        agent: descriptor.agent,
        a: toVersionSummary(descriptor.a),
        b: toVersionSummary(descriptor.b),
        runAt: descriptor.runAt,
    };
}

function panelTitle(utterance: string): string {
    const trimmed = utterance.trim();
    const clipped =
        trimmed.length > TITLE_UTTERANCE_MAX
            ? `${trimmed.slice(0, TITLE_UTTERANCE_MAX - 1)}…`
            : trimmed;
    return `Trace — ${clipped}`;
}

/**
 * Open (or reveal) the Trace Viewer for one red row of a run, side-by-side with
 * the Impact Report it drills in from. The panel is keyed by
 * `${runId}::${utteranceId}` so each row opens its own tab, and it sits beside
 * the report rather than stealing its column.
 *
 * The stored trace and its run descriptor are the source of truth: the viewer
 * shows the exact resolution the row was produced from, and a "Replay" recompute
 * runs the same pinned inputs through the live service to reveal working-tree
 * drift. When the run's traces have been rotated out of the durable store, the
 * viewer shows an explicit evicted/missing state instead of a blank panel.
 */
export function openTraceViewer(
    context: vscode.ExtensionContext,
    repoRoot: string | undefined,
    connection: ImpactReportConnection,
    runId: string,
    utteranceId: string,
): void {
    let client: StudioServiceClient | undefined;
    let connecting: Promise<StudioServiceClient | undefined> | undefined;
    let webviewReady = false;
    let stateSub: { dispose(): void } | undefined;

    // Seed the title from the stored trace when it's still present; a lookup
    // miss (evicted/missing) still opens the panel, which then explains itself.
    const seeded = loadResolutionTrace(
        context.workspaceState,
        runId,
        utteranceId,
    );
    const title = seeded ? panelTitle(seeded.trace.utterance) : "Trace";

    const panel = WebviewKitPanel.createOrReveal(context, {
        viewType: VIEW_TYPE,
        instanceKey: `${runId}::${utteranceId}`,
        title,
        // Sit next to the originating Impact Report instead of taking its column.
        viewColumn: vscode.ViewColumn.Beside,
        scriptPath: ["dist", "webview", "traceViewer.js"],
        stylePath: ["media", "traceViewer.css"],
        // The panel holds a live service connection (for Replay) and a rendered
        // trace re-pushed only via the reveal `ready` handshake; retain context
        // so navigating away and back keeps that state.
        retainContextWhenHidden: true,
        onMessage: (raw) => void handleMessage(raw),
        onDispose: () => {
            stateSub?.dispose();
            stateSub = undefined;
            client?.close();
            client = undefined;
            connecting = undefined;
        },
    });

    const post = (message: HostToTraceMessage) => panel.post(message);

    // Single-flight connect so a concurrent ready/replay doesn't open multiple
    // sockets; failures aren't cached (a later reconnect/replay retries).
    const ensureClient = (): Promise<StudioServiceClient | undefined> => {
        if (client) {
            return Promise.resolve(client);
        }
        if (!connecting) {
            const target = connection.getTarget();
            connecting = StudioServiceClient.connect({
                ...(repoRoot !== undefined ? { repoRoot } : {}),
                ...(target !== undefined
                    ? { endpoint: target.endpoint, token: target.token }
                    : {}),
            })
                .then((c) => {
                    client = c;
                    return c;
                })
                .finally(() => {
                    connecting = undefined;
                });
        }
        return connecting;
    };

    // Read the stored trace and push it, or explain why it can't be shown. The
    // per-row lookup answers "present"; a miss is disambiguated at the run level
    // into evicted (rotated out) vs missing (never captured).
    const pushTrace = (): void => {
        const found = loadResolutionTrace(
            context.workspaceState,
            runId,
            utteranceId,
        );
        if (found) {
            post({
                type: "trace",
                recorded: found.trace,
                provenance: toProvenance(found.descriptor),
            });
            return;
        }
        const run = loadTraceRun(context.workspaceState, runId);
        post({
            type: "trace-state",
            state: run.status === "evicted" ? "evicted" : "missing",
        });
    };

    // Recompute a fresh trace for this row from the run's pinned inputs, so the
    // viewer can contrast the recorded resolution with what the same versions
    // produce now (revealing working-tree drift). Needs the descriptor, which
    // rides with the stored trace; if that's gone, report unavailable.
    const runReplay = async (requestId: number): Promise<void> => {
        const found = loadResolutionTrace(
            context.workspaceState,
            runId,
            utteranceId,
        );
        if (!found) {
            post({
                type: "replay-result",
                requestId,
                status: "unavailable",
                message: "The recorded run is no longer available to replay.",
            });
            return;
        }
        const c = await ensureClient();
        if (!c) {
            post({
                type: "replay-result",
                requestId,
                status: "unavailable",
                message: "Couldn't reach the studio service.",
            });
            return;
        }
        try {
            const result = await c.replayResolutionTrace({
                descriptor: found.descriptor,
                utteranceId,
            });
            if (result.status === "recomputed") {
                post({
                    type: "replay-result",
                    requestId,
                    status: "recomputed",
                    fresh: result.trace,
                });
            } else {
                post({
                    type: "replay-result",
                    requestId,
                    status: result.status,
                });
            }
        } catch {
            post({
                type: "replay-result",
                requestId,
                status: "unavailable",
                message: "Replay failed. The recorded trace is still shown.",
            });
        }
    };

    const handleMessage = async (raw: unknown): Promise<void> => {
        const message = parseTraceMessage(raw);
        if (!message) {
            return;
        }
        switch (message.type) {
            case "ready":
                webviewReady = true;
                post({
                    type: "connection",
                    state: connection.currentState,
                });
                pushTrace();
                break;
            case "replay":
                await runReplay(message.requestId);
                break;
            case "open-source":
                // Source navigation is wired in a follow-up; report gracefully
                // so the webview can surface an unavailable state rather than
                // leaving the affordance hanging.
                post({
                    type: "source-result",
                    requestId: message.requestId,
                    status: "unavailable",
                    message: "Source navigation isn't available yet.",
                });
                break;
        }
    };

    // Mirror the shared connection so the viewer shows one indicator and the
    // next replay dials a fresh socket after a reconnect. The immediate fire on
    // subscribe can land before the webview is ready (guarded); the `ready` pull
    // seeds the first state.
    stateSub = connection.onStateChanged((state: StudioConnectionState) => {
        if (!webviewReady) {
            return;
        }
        post({ type: "connection", state });
        if (state === "connected") {
            client?.close();
            client = undefined;
            connecting = undefined;
        }
    });
}
