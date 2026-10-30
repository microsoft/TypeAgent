// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { RpcDisconnectedError } from "@typeagent/agent-rpc/rpc";
import type { ViewRequest } from "@typeagent/browser-control-rpc/viewRpc";
import type { SSEManager } from "../../core/types.js";
import { SSEManagerImpl } from "../../core/sseManager.js";
import { validateViewRequest } from "./viewValidation.mjs";
import type {
    UnderstandingRequest,
    UnderstandingResult,
} from "@typeagent/memory-service";
import { memoryPerformanceExperiments } from "@typeagent/memory-service";
import {
    understandingRequestSchema,
    understandingResultSchema,
} from "@typeagent/memory-client";

export async function* understandingStages(
    input: UnderstandingRequest,
    invoke: (request: ViewRequest) => Promise<unknown>,
    signal?: AbortSignal,
    preview = false,
): AsyncGenerator<UnderstandingResult> {
    const read = async (params: UnderstandingRequest) => {
        signal?.throwIfAborted();
        const result = understandingResultSchema.parse(
            await invoke(
                validateViewRequest({
                    method: "memoryHubUnderstand",
                    params,
                }),
            ),
        ) as UnderstandingResult;
        signal?.throwIfAborted();
        return result;
    };
    if (preview && !input.evidenceSnapshotId)
        yield await read({ ...input, phase: "preview" });
    const sources = await read({ ...input, phase: "retrieve" });
    yield sources;
    if (!sources.evidenceSnapshotId)
        throw new Error("Understanding host did not retain prepared evidence");
    const initial = await read({
        ...input,
        phase: "initial",
        evidenceSnapshotId: sources.evidenceSnapshotId,
    });
    yield initial;
    if (initial.refinementPending) {
        if (!initial.evidenceSnapshotId)
            throw new Error("Understanding refinement snapshot is unavailable");
        yield await read({
            ...input,
            phase: "refine",
            evidenceSnapshotId: initial.evidenceSnapshotId,
        });
    }
}

export function registerViewRoutes(
    app: Express,
    sse: SSEManager,
    invoke: (request: ViewRequest) => Promise<unknown>,
) {
    const preview = memoryPerformanceExperiments().has("source-preview");
    app.post("/api/views/understand", async (req, res) => {
        let request: UnderstandingRequest;
        try {
            if (!req.is("application/json"))
                throw new Error("Expected application/json");
            request = understandingRequestSchema.parse(req.body);
            request.requestId ??= randomUUID();
        } catch {
            res.status(400).json({
                success: false,
                error: "Invalid understanding request",
            });
            return;
        }
        SSEManagerImpl.setupSSEHeaders(res);
        res.flushHeaders();
        let disconnected = false;
        const controller = new AbortController();
        res.on("close", () => {
            disconnected = true;
            controller.abort();
            if (!res.writableEnded)
                void invoke(
                    validateViewRequest({
                        method: "memoryHubCancelUnderstanding",
                        params: {
                            corpusId: request.corpusId,
                            requestId: request.requestId,
                        },
                    }),
                ).catch((error: unknown) =>
                    console.warn("Understanding cancellation failed", error),
                );
        });
        const heartbeat = setInterval(() => {
            if (!disconnected) res.write(": keepalive\n\n");
        }, 15000);
        try {
            for await (const data of understandingStages(
                request,
                invoke,
                controller.signal,
                preview,
            )) {
                if (disconnected) break;
                res.write(
                    `data: ${JSON.stringify({ type: "result", data })}\n\n`,
                );
            }
            if (!disconnected) res.write('data: {"type":"complete"}\n\n');
        } catch (error) {
            if (!disconnected)
                res.write(
                    `data: ${JSON.stringify({
                        type: "error",
                        error:
                            error instanceof Error
                                ? error.message
                                : "Understanding failed",
                    })}\n\n`,
                );
        } finally {
            clearInterval(heartbeat);
            res.end();
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
            if (
                (request.method === "memoryHubUnderstand" ||
                    request.method === "memoryHubUnderstandingModule") &&
                request.params.requestId
            ) {
                const { corpusId, requestId } = request.params;
                res.on("close", () => {
                    if (!res.writableEnded)
                        void invoke(
                            validateViewRequest({
                                method: "memoryHubCancelUnderstanding",
                                params: { corpusId, requestId },
                            }),
                        ).catch((error: unknown) =>
                            console.warn(
                                "Understanding cancellation failed",
                                error,
                            ),
                        );
                });
            }
            const data = await invoke(request);
            if (res.destroyed) return;
            res.json({ success: true, data: data ?? null });
        } catch (error) {
            if (res.destroyed) return;
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
