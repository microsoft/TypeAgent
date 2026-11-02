// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { randomUUID } from "node:crypto";
import { JSONRPCRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
    FileMemoryService,
    type MemoryAnswerRequest,
    type MemoryAnswerResult,
} from "@typeagent/memory-service";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MemoryServiceHost } from "../src/memoryServiceHost.js";

test("authenticated MCP cancellation reaches the foreground answer signal", async () => {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "memory-answer-protocol-"),
    );
    let entered!: () => void, aborted!: () => void;
    const started = new Promise<void>((resolve) => {
        entered = resolve;
    });
    const cancelled = new Promise<void>((resolve) => {
        aborted = resolve;
    });
    let requestId: string | number | undefined;
    let nativeSignal: AbortSignal | undefined;
    const clientId = randomUUID();
    class Service extends FileMemoryService {
        public override async answer(
            _request: MemoryAnswerRequest,
            signal?: AbortSignal,
        ): Promise<MemoryAnswerResult> {
            if (!signal) throw new Error("MCP omitted request cancellation.");
            nativeSignal = signal;
            entered();
            return new Promise((_resolve, reject) => {
                signal.addEventListener(
                    "abort",
                    () => {
                        aborted();
                        reject(signal.reason);
                    },
                    { once: true },
                );
            });
        }
    }
    const service = new Service(root);
    const host = await MemoryServiceHost.start(service, { previews: false });
    const client = new Client({
        name: "answer-cancellation-test",
        version: "1",
    });
    const controller = new AbortController();
    try {
        await client.connect(
            new StreamableHTTPClientTransport(new URL(host.endpoint), {
                fetch: async (url, options) => {
                    if (typeof options?.body === "string") {
                        const request = JSONRPCRequestSchema.safeParse(
                            JSON.parse(options.body),
                        );
                        if (
                            request.success &&
                            request.data.method === "tools/call"
                        )
                            requestId = request.data.id;
                    }
                    return globalThis.fetch(url, options);
                },
                requestInit: {
                    headers: {
                        Authorization: `Bearer ${host.bearerToken}`,
                        "X-TypeAgent-Client-Id": clientId,
                    },
                },
            }) as Transport,
        );
        const answer = client.callTool(
            {
                name: "memory_answer",
                arguments: { corpusId: "fixture", question: "Why?" },
            },
            undefined,
            { signal: controller.signal },
        );
        const rejected = expect(answer).rejects.toBeDefined();
        await Promise.race([
            started,
            new Promise<never>((_resolve, reject) => {
                setTimeout(
                    () =>
                        reject(
                            new Error("MCP foreground answer did not start"),
                        ),
                    5000,
                ).unref();
            }),
        ]);
        expect(requestId).toBeDefined();
        const unrelated = await fetch(host.endpoint, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${host.bearerToken}`,
                "X-TypeAgent-Client-Id": randomUUID(),
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "notifications/cancelled",
                params: { requestId },
            }),
        });
        expect(unrelated.status).toBe(202);
        expect(nativeSignal?.aborted).toBe(false);
        const duplicate = await fetch(host.endpoint, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${host.bearerToken}`,
                "X-TypeAgent-Client-Id": clientId,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: requestId,
                method: "tools/call",
                params: {
                    name: "memory_answer",
                    arguments: { corpusId: "fixture", question: "Duplicate?" },
                },
            }),
        });
        expect(duplicate.status).toBe(409);
        const malformed = await fetch(host.endpoint, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${host.bearerToken}`,
                "X-TypeAgent-Client-Id": "not-a-client-uuid",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "notifications/cancelled",
                params: { requestId },
            }),
        });
        expect(malformed.status).toBe(400);
        expect(nativeSignal?.aborted).toBe(false);
        controller.abort();
        await rejected;
        await Promise.race([
            cancelled,
            new Promise<never>((_resolve, reject) => {
                setTimeout(
                    () =>
                        reject(
                            new Error(
                                "MCP cancellation did not reach the service",
                            ),
                        ),
                    5000,
                ).unref();
            }),
        ]);
    } finally {
        controller.abort();
        await client.close();
        await host.close();
        await rm(root, { recursive: true, force: true });
    }
});
