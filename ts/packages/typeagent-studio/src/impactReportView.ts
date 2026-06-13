// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { WebviewKitPanel } from "./webviewKit/host.js";
import {
    parseWebviewMessage,
    type HostToWebviewMessage,
} from "./webviewKit/protocol.js";
import { StudioServiceClient } from "./studioServiceClient.js";

const VIEW_TYPE = "typeagentStudio.impactReport";

/**
 * Open (or reveal) the Impact Report webview — the first greenfield client of
 * the `studio` service channel. The webview never opens a socket: it asks the
 * extension host (here) to run a replay, and the host drives the agent's runtime
 * over the channel (`listCorpusAgents` / `replayCorpus`) and posts typed results
 * back. The channel client is owned per-panel and closed on dispose.
 */
export function openImpactReport(
    context: vscode.ExtensionContext,
    repoRoot: string | undefined,
    getTarget: () => { endpoint: string; token: string } | undefined,
): void {
    let client: StudioServiceClient | undefined;
    let connecting: Promise<StudioServiceClient | undefined> | undefined;

    const panel = WebviewKitPanel.createOrReveal(context, {
        viewType: VIEW_TYPE,
        title: "Studio Impact Report",
        scriptPath: ["dist", "webview", "impactReport.js"],
        stylePath: ["media", "impactReport.css"],
        onMessage: (raw) => void handleMessage(raw),
        onDispose: () => {
            client?.close();
            client = undefined;
            connecting = undefined;
        },
    });

    const post = (message: HostToWebviewMessage) => panel.post(message);

    // Single-flight connect so concurrent ready/run don't open multiple sockets;
    // failures aren't cached (a later reconnect/run retries).
    const ensureClient = (): Promise<StudioServiceClient | undefined> => {
        if (client) {
            return Promise.resolve(client);
        }
        if (!connecting) {
            // Reach the same standalone service the shared connection uses (the
            // agent no longer serves the runtime, so there is no discovery
            // fallback); a dedicated client keeps heavy replay off the shared one.
            const target = getTarget();
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

    const sendInit = async (): Promise<void> => {
        post({ type: "status", text: "Connecting to the studio service…" });
        const c = await ensureClient();
        if (!c) {
            post({ type: "init", agents: [], connected: false });
            return;
        }
        let agents: string[] = [];
        try {
            agents = await c.listCorpusAgents();
        } catch {
            // Connected but listing failed; surface an empty agent list.
        }
        post({ type: "init", agents, connected: true });
    };

    const handleMessage = async (raw: unknown): Promise<void> => {
        const msg = parseWebviewMessage(raw);
        if (!msg) {
            return;
        }
        if (msg.type === "ready" || msg.type === "reconnect") {
            if (msg.type === "reconnect") {
                client?.close();
                client = undefined;
            }
            await sendInit();
            return;
        }
        // msg.type === "run"
        try {
            const c = await ensureClient();
            if (!c) {
                post({
                    type: "error",
                    requestId: msg.requestId,
                    message: "Not connected to the studio service.",
                });
                return;
            }
            const payload = await c.replayCorpus({
                agent: msg.agent,
                // The shell uses the deterministic policy (working tree vs
                // working tree → an all-equal baseline) to prove the channel
                // and the ActionDelta contract without a two-version build.
                missPolicy: "needs-explanation",
            });
            post({ type: "result", requestId: msg.requestId, payload });
        } catch (e) {
            post({
                type: "error",
                requestId: msg.requestId,
                message: e instanceof Error ? e.message : "Replay failed.",
            });
        }
    };
}
