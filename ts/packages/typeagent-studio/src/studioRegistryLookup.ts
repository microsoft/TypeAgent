// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import WebSocket from "ws";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import { discoverPort } from "@typeagent/agent-server-client/discovery";
import {
    STUDIO_REGISTRY_ROLE,
    type StudioRegistryInvokeFunctions,
    type StudioServiceEntry,
} from "@typeagent/core/runtime";
import { createWebSocketRpcChannel } from "./studioServiceClient.js";

/**
 * Extension-side client for the `studio` agent's registry relay: discover the
 * agent's registry endpoint (registrar role {@link STUDIO_REGISTRY_ROLE}) and
 * ask which standalone service — if any — is live for `workspaceKey`. Used by
 * the launcher to attach to an already-running service (e.g. another window's)
 * before launching a new one.
 *
 * Kept separate from the heavyweight `studio-service` package (which pulls in
 * the runtime) so the extension bundle stays lean — it reuses only agent-rpc,
 * `ws`, and the discovery client it already depends on.
 */
export async function lookupStudioService(
    workspaceKey: string,
    options: { agentServerUrl?: string } = {},
): Promise<StudioServiceEntry | null> {
    const result = await discoverPort(
        "studio",
        STUDIO_REGISTRY_ROLE,
        options.agentServerUrl !== undefined
            ? { url: options.agentServerUrl }
            : undefined,
    );
    if (result.kind !== "found") {
        return null;
    }
    const endpoint = `ws://127.0.0.1:${result.port}`;
    const socket = await new Promise<WebSocket | undefined>((resolve) => {
        const s = new WebSocket(endpoint);
        let settled = false;
        const settle = (value: WebSocket | undefined) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
        s.once("open", () => settle(s));
        s.once("error", () => {
            try {
                s.terminate();
            } catch {
                // Already closed.
            }
            settle(undefined);
        });
    });
    if (socket === undefined) {
        return null;
    }
    try {
        const rpc = createRpc<StudioRegistryInvokeFunctions>(
            "studio:registry:lookup",
            createWebSocketRpcChannel(socket),
        );
        return await rpc.invoke("lookup", workspaceKey);
    } catch {
        return null;
    } finally {
        socket.close();
    }
}
