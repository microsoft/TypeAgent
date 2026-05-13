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

// One-shot resolution of the code agent's WebSocket endpoint via the
// agent-server's discovery channel. Returns undefined if the endpoint
// can't be resolved (discovery unreachable, or `code` agent not yet
// enabled in any session) — the caller's reconnect loop will retry.
// Honors:
//   - `CODE_WEBSOCKET_HOST` env: explicit override; if set, skips
//     discovery and dials the given URL directly.
//   - `AGENT_SERVER_URL` env: where to reach the agent-server's
//     discovery WS (defaults to ws://localhost:8999, the
//     AGENT_SERVER_DEFAULT_URL constant).
async function resolveCodeEndpoint(): Promise<string | undefined> {
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
        // Transient — the reconnect loop will re-discover periodically.
        console.log(
            "code agent not yet registered with agent-server; will retry.",
        );
        return undefined;
    }
    // Discovery unreachable (agentServer not running). Reconnect loop
    // will retry.
    console.log(
        `Discovery channel unreachable (${result.error.message}); will retry.`,
    );
    return undefined;
}

export async function createWebSocket(
    channel: string,
    role: string,
    clientId?: string,
) {
    return new Promise<WebSocket | undefined>(async (resolve) => {
        const base = await resolveCodeEndpoint();
        if (!base) {
            resolve(undefined);
            return;
        }
        let endpoint = `${base}?channel=${channel}&role=${role}`;
        if (clientId) {
            endpoint += `&clientId=${clientId}`;
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
