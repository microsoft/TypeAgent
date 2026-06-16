// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import WebSocket from "ws";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import type {
    StudioInfo,
    StudioServiceInvokeFunctions,
} from "@typeagent/core/runtime";
import type {
    StudioEvent,
    CollisionDetectedEvent,
} from "@typeagent/core/events";
import { createWebSocketRpcChannel } from "./studioServiceServer.js";

/**
 * Minimal client the `studio` agent uses to **forward** its read-only actions
 * to the standalone Studio service it discovered via the registry (the agent
 * proxy path — it no longer hosts the runtime). Connects to `{port, token}`,
 * invokes one of the read methods, and is closed by the caller.
 *
 * Distinct from the extension's full `StudioServiceClient`: the agent needs
 * only the three Inspect reads and lives in a node process, so this stays tiny.
 */
export class StudioServiceProxyClient {
    private constructor(
        private readonly socket: WebSocket,
        private readonly rpc: ReturnType<
            typeof createRpc<StudioServiceInvokeFunctions>
        >,
        private readonly repoRoot: string | undefined,
    ) {}

    /**
     * Connect to a service at `127.0.0.1:port`, presenting `token` as a
     * capability bearer. Resolves `undefined` when the socket can't be opened
     * (service gone / bad token) so the caller can report "not running".
     */
    static async connect(options: {
        port: number;
        token: string;
        repoRoot?: string;
    }): Promise<StudioServiceProxyClient | undefined> {
        const socket = await new Promise<WebSocket | undefined>((resolve) => {
            const s = new WebSocket(`ws://127.0.0.1:${options.port}`, {
                headers: { Authorization: `Bearer ${options.token}` },
            });
            let settled = false;
            const settle = (value: WebSocket | undefined) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };
            s.once("open", () => settle(s));
            s.once("unexpected-response", () => {
                try {
                    s.terminate();
                } catch {
                    // Already closed.
                }
                settle(undefined);
            });
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
            return undefined;
        }
        const rpc = createRpc<StudioServiceInvokeFunctions>(
            "studio:proxy",
            createWebSocketRpcChannel(socket),
        );
        return new StudioServiceProxyClient(socket, rpc, options.repoRoot);
    }

    getStudioInfo(): Promise<StudioInfo> {
        return this.rpc.invoke("getStudioInfo", this.repoRoot);
    }

    listCollisions(): Promise<CollisionDetectedEvent[]> {
        return this.rpc.invoke("listCollisions", this.repoRoot);
    }

    queryRecentEvents(limit?: number): Promise<StudioEvent[]> {
        return this.rpc.invoke("queryRecentEvents", this.repoRoot, limit);
    }

    close(): void {
        this.socket.close();
    }
}
