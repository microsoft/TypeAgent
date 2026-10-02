// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Express } from "express";
import { RpcDisconnectedError } from "@typeagent/agent-rpc/rpc";
import type { ViewRequest } from "@typeagent/browser-control-rpc/viewRpc";
import type { SSEManager } from "../../core/types.js";
import { SSEManagerImpl } from "../../core/sseManager.js";
import { validateViewRequest } from "./viewValidation.mjs";

export function registerViewRoutes(
    app: Express,
    sse: SSEManager,
    invoke: (request: ViewRequest) => Promise<unknown>,
) {
    app.post("/api/views/invoke", async (req, res) => {
        if (!req.is("application/json")) {
            res.status(415).json({
                success: false,
                error: "Expected application/json",
            });
            return;
        }
        let request: ViewRequest;
        try {
            request = validateViewRequest(req.body);
        } catch {
            res.status(400).json({
                success: false,
                error: "Invalid view method or parameters",
            });
            return;
        }
        try {
            const data = await invoke(request);
            res.json({ success: true, data: data ?? null });
        } catch (error) {
            const disconnected = error instanceof RpcDisconnectedError;
            res.status(disconnected ? 503 : 500).json({
                success: false,
                error: disconnected
                    ? "View agent disconnected"
                    : error instanceof Error
                      ? error.message
                      : "View operation failed",
            });
        }
    });
    app.get("/api/views/events", (_req, res) => {
        SSEManagerImpl.setupSSEHeaders(res);
        res.flushHeaders();
        sse.addClient("views", res);
        const heartbeat = setInterval(
            () => res.write(": keepalive\n\n"),
            15000,
        );
        res.on("close", () => clearInterval(heartbeat));
    });
}
