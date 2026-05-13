// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import WebSocket from "ws";
import { discoverPort } from "@typeagent/agent-server-client/discovery";

export type WebSocketMessage = {
    source: string;
    target: string;
    id?: string;
    messageType: string;
    body: any;
};

// Back-compat fallback: pre-port-registrar versions of this extension
// dialed `ws://localhost:8082` directly. We still honor that target if
// the discovery channel is unreachable (agentServer not running, or an
// older agentServer without the discovery channel) so users running
// against an old agent server aren't broken on update.
const CODE_AGENT_FALLBACK_HOST = "ws://localhost:8082";

// One-shot resolution of the code agent's WebSocket endpoint. Tries the
// agent-server's discovery channel first, falls back to the legacy
// hardcoded host. Honors:
//   - `CODE_WEBSOCKET_HOST` env: explicit override; if set, skips
//     discovery and dials the given URL directly.
//   - `AGENT_SERVER_URL` env: where to reach the agent-server's
//     discovery WS (defaults to ws://localhost:8999, the
//     AGENT_SERVER_DEFAULT_URL constant).
async function resolveCodeEndpoint(): Promise<string> {
    const explicit = process.env["CODE_WEBSOCKET_HOST"];
    if (explicit) return explicit;

    const result = await discoverPort("code", undefined, {
        url: process.env["AGENT_SERVER_URL"],
    });
    if (result.kind === "found") {
        return `ws://localhost:${result.port}`;
    }
    if (result.kind === "not-registered") {
        // Agent server is running but the `code` agent isn't enabled
        // (no one has activated the `code` schema in any session yet).
        // The reconnect loop will re-discover periodically, so this
        // is a transient state — log and fall back to the legacy host
        // for a still-non-zero chance the user happens to be running
        // an old agent server too.
        console.log(
            "code agent not yet registered with agent-server; will retry. Falling back to legacy 8082 in case of pre-discovery agent server.",
        );
        return CODE_AGENT_FALLBACK_HOST;
    }
    // Discovery unreachable (agentServer down or pre-discovery
    // version). Fall back to the legacy host so users with an old
    // server keep working.
    console.log(
        `Discovery channel unreachable (${result.error.message}). Falling back to legacy ${CODE_AGENT_FALLBACK_HOST}.`,
    );
    return CODE_AGENT_FALLBACK_HOST;
}

export async function createWebSocket(
    channel: string,
    role: string,
    clientId?: string,
) {
    return new Promise<WebSocket | undefined>(async (resolve) => {
        const base = await resolveCodeEndpoint();
        let endpoint = `${base}?channel=${channel}&role=${role}`;
        if (clientId) {
            endpoint += `clientId=${clientId}`;
        }

        const webSocket = new WebSocket(endpoint);

        webSocket.onopen = (event: object) => {
            console.log("websocket open");
            resolve(webSocket);
        };
        webSocket.onmessage = (event: object) => {};
        webSocket.onclose = (event: object) => {
            console.log("websocket connection closed");
            resolve(undefined);
        };
        webSocket.onerror = (event: object) => {
            console.error("websocket error");
            resolve(undefined);
        };
    });
}

export function keepWebSocketAlive(webSocket: WebSocket) {
    const keepAliveIntervalId = setInterval(() => {
        if (webSocket && webSocket.readyState === WebSocket.OPEN) {
            webSocket.send(
                JSON.stringify({
                    method: "keepAlive",
                    params: {},
                }),
            );
        } else {
            console.log("Clearing keepalive retry interval");
            clearInterval(keepAliveIntervalId);
        }
    }, 20 * 1000);
}
