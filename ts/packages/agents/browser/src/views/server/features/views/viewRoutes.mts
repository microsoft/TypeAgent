// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Express } from "express";
import { createHash } from "node:crypto";
import { z } from "zod";
import { RpcDisconnectedError } from "@typeagent/agent-rpc/rpc";
import type { ViewRequest } from "@typeagent/browser-control-rpc/viewRpc";
import type { SSEManager } from "../../core/types.js";
import { SSEManagerImpl } from "../../core/sseManager.js";
import { validateViewRequest } from "./viewValidation.mjs";

const assetResponse = z.object({
    asset: z.object({
        mimeType: z.enum([
            "image/png",
            "image/jpeg",
            "image/gif",
            "image/webp",
            "application/pdf",
        ]),
        size: z
            .number()
            .int()
            .positive()
            .max(6 * 1024 * 1024),
        hash: z.string().regex(/^[a-f0-9]{64}$/),
    }),
    data: z
        .string()
        .max(8 * 1024 * 1024)
        .regex(/^[A-Za-z0-9+/]*={0,2}$/),
});

export function registerViewRoutes(
    app: Express,
    sse: SSEManager,
    invoke: (request: ViewRequest) => Promise<unknown>,
) {
    app.get("/api/views/runbook-asset", async (req, res) => {
        let request: ViewRequest;
        try {
            const query = req.query;
            request = validateViewRequest({
                method: "memoryHubReadRunbookAsset",
                params: {
                    corpusId: query.corpusId,
                    sourceId: query.sourceId,
                    revisionId: query.revisionId,
                    assetId: query.assetId,
                    hash: query.hash,
                    variant: query.variant,
                    ...(query.acknowledgeUnreviewed === "true"
                        ? { acknowledgeUnreviewed: true }
                        : {}),
                },
            });
        } catch {
            res.status(400).json({
                success: false,
                error: "Invalid revision-asset request",
            });
            return;
        }
        try {
            const value = await invoke(request);
            const result = assetResponse.parse(value);
            const bytes = Buffer.from(result.data, "base64");
            if (bytes.length !== result.asset.size)
                throw new Error(
                    "Revision asset size does not match retained metadata",
                );
            if (
                createHash("sha256").update(bytes).digest("hex") !==
                result.asset.hash
            )
                throw new Error(
                    "Revision asset digest does not match retained metadata",
                );
            res.setHeader("Content-Type", result.asset.mimeType);
            res.setHeader("Content-Disposition", "inline");
            res.setHeader("X-Content-Type-Options", "nosniff");
            res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
            res.setHeader("Cache-Control", "no-store");
            res.setHeader(
                "Content-Security-Policy",
                "default-src 'none'; frame-ancestors 'none'; sandbox",
            );
            res.send(bytes);
        } catch (error) {
            res.status(error instanceof RpcDisconnectedError ? 503 : 500).json({
                success: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Revision asset unavailable",
            });
        }
    });
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
