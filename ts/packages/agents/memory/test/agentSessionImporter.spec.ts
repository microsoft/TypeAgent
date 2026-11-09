// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { appendFile, link, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
    AgentSessionImportReceipt,
    AgentSessionImportRequest,
    MemoryService,
} from "@typeagent/memory-service";
import { importAgentSessionPath } from "../src/agentSessionImporter.js";

const scratch = resolve("test", `.agent-session-import-${randomUUID()}`);

beforeAll(async () => {
    await mkdir(scratch, { recursive: true });
});
afterAll(async () => {
    await rm(scratch, { recursive: true, force: true });
});

function fixture(
    onSubmit?: (request: AgentSessionImportRequest) => Promise<void>,
) {
    const requests: AgentSessionImportRequest[] = [];
    let active: AgentSessionImportReceipt | undefined;
    let polls = 0;
    let nextCursor = 0;
    const service = {
        importAgentSession: async (request: AgentSessionImportRequest) => {
            if (active?.state === "running")
                throw new Error("Overlapping chunks");
            if (request.expectedCursor !== (active?.cursor ?? 0))
                throw new Error("Wrong cursor");
            requests.push(structuredClone(request));
            await onSubmit?.(request);
            nextCursor =
                request.expectedCursor +
                request.jsonl.split("\n").filter((line) => line.trim()).length;
            active = {
                schemaVersion: 1,
                corpusId: request.corpusId,
                sessionId: request.sessionId,
                importType: request.importType,
                state: "running",
                cursor: request.expectedCursor,
                final: request.final ?? false,
                sourceCount: requests.length,
                memoryCount: 0,
                duplicates: 0,
                losses: [],
                updatedAt: new Date().toISOString(),
            };
            return structuredClone(active);
        },
        getAgentSessionImport: async () => {
            polls++;
            active!.cursor = nextCursor;
            active!.state = active!.final ? "complete" : "partial";
            return structuredClone(active);
        },
    } as unknown as MemoryService;
    return { service, requests, getPolls: () => polls };
}

function replayFixture(
    options: {
        failAtCursor?: number;
        onCommit?: (cursor: number) => void;
    } = {},
) {
    const hashes = new Map<string, string>();
    const requests: AgentSessionImportRequest[] = [];
    const workKeys: string[] = [];
    let pending: AgentSessionImportRequest | undefined;
    let failed = false;
    let receipt: AgentSessionImportReceipt = {
        schemaVersion: 1,
        corpusId: "corpus",
        sessionId: "session",
        importType: "agent-session-jsonl",
        state: "partial",
        cursor: 0,
        final: false,
        sourceCount: 0,
        memoryCount: 0,
        duplicates: 0,
        losses: [],
        updatedAt: new Date().toISOString(),
    };
    const service = {
        importAgentSession: async (request: AgentSessionImportRequest) => {
            requests.push(structuredClone(request));
            const previous = hashes.get(request.idempotencyKey);
            const hash = JSON.stringify(request);
            if (previous !== undefined && previous !== hash) {
                throw new Error(
                    "Agent session idempotency key has different content",
                );
            }
            if (
                previous !== undefined &&
                pending?.idempotencyKey !== request.idempotencyKey
            ) {
                return structuredClone(receipt);
            }
            if (pending && pending.idempotencyKey !== request.idempotencyKey) {
                throw new Error("Retry unfinished chunk first");
            }
            if (
                !pending &&
                (receipt.final || request.expectedCursor !== receipt.cursor)
            ) {
                throw new Error(
                    "Wrong continuation cursor or finalized session",
                );
            }
            hashes.set(request.idempotencyKey, hash);
            pending = structuredClone(request);
            workKeys.push(request.idempotencyKey);
            if (!failed && options.failAtCursor === request.expectedCursor) {
                failed = true;
                receipt.state = "failed";
                receipt.error = "Offline chunk failure";
            } else {
                receipt.state = "running";
                delete receipt.error;
            }
            return structuredClone(receipt);
        },
        getAgentSessionImport: async () => {
            if (receipt.state === "running" && pending) {
                receipt = {
                    ...receipt,
                    cursor:
                        pending.expectedCursor +
                        pending.jsonl.split("\n").filter((line) => line.trim())
                            .length,
                    final: pending.final ?? false,
                    state: pending.final ? "complete" : "partial",
                };
                pending = undefined;
                options.onCommit?.(receipt.cursor);
            }
            return structuredClone(receipt);
        },
    } as unknown as MemoryService;
    return { service, requests, workKeys };
}

test("completed multi-chunk reimport validates every original key without replaying work", async () => {
    const path = resolve(scratch, "completed-replay.jsonl");
    const content = "{}\n".repeat(2501);
    await writeFile(path, content);
    const { service, requests, workKeys } = replayFixture();
    const options = {
        path,
        corpusId: "corpus",
        sessionId: "session",
        importType: "agent-session-jsonl" as const,
        pollIntervalMs: 1,
    };
    const initial = await importAgentSessionPath(service, options);
    const originalRequests = structuredClone(requests);
    const workCount = workKeys.length;
    expect(initial.cursor).toBe(2501);
    expect(originalRequests).toHaveLength(4);
    expect(await importAgentSessionPath(service, options)).toEqual(initial);
    expect(requests.slice(4)).toEqual(originalRequests);
    expect(workKeys).toHaveLength(workCount);

    // A valid prefix and current final receipt cannot authorize skipping a changed later chunk.
    await writeFile(
        path,
        "{}\n".repeat(1000) + '{"changed":true}\n' + "{}\n".repeat(1500),
    );
    await expect(importAgentSessionPath(service, options)).rejects.toThrow(
        "idempotency key has different content",
    );
    expect(requests[requests.length - 1].idempotencyKey).toBe(
        originalRequests[1].idempotencyKey,
    );
    expect(workKeys).toHaveLength(workCount);
});

test.each(["paused", "failed"] as const)(
    "%s later-chunk continuation replays earlier keys at their original cursors",
    async (mode) => {
        const path = resolve(scratch, `${mode}-replay.jsonl`);
        await writeFile(path, "{}\n".repeat(2501));
        const controller = new AbortController();
        const { service, requests, workKeys } = replayFixture({
            ...(mode === "failed" ? { failAtCursor: 2000 } : {}),
            onCommit: (cursor) => {
                if (mode === "paused" && cursor === 2000) controller.abort();
            },
        });
        const options = {
            path,
            corpusId: "corpus",
            sessionId: "session",
            importType: "agent-session-jsonl" as const,
            pollIntervalMs: 1,
        };
        await expect(
            importAgentSessionPath(service, {
                ...options,
                signal: controller.signal,
            }),
        ).rejects.toThrow();
        const beforeRetry = requests.length;
        const firstKeys = requests
            .slice(0, 2)
            .map((request) => request.idempotencyKey);
        const result = await importAgentSessionPath(service, options);
        expect(result).toMatchObject({
            state: "complete",
            final: true,
            cursor: 2501,
        });
        expect(
            requests
                .slice(beforeRetry)
                .map((request) => request.expectedCursor),
        ).toEqual([0, 1000, 2000, 2501]);
        expect(
            requests
                .slice(beforeRetry, beforeRetry + 2)
                .map((request) => request.idempotencyKey),
        ).toEqual(firstKeys);
        for (const key of firstKeys) {
            expect(workKeys.filter((workKey) => workKey === key)).toHaveLength(
                1,
            );
        }
    },
);

test.each(["agent-session-jsonl", "copilot-session-jsonl"] as const)(
    "native %s import streams byte/line-bounded content and polls before the next cursor",
    async (importType) => {
        const path = resolve(scratch, `${importType}.jsonl`);
        const lines = Array.from({ length: 1100 }, (_, id) =>
            JSON.stringify({ id: `event-${id}`, text: "é".repeat(600) }),
        );
        const jsonl = lines.join("\r\n");
        await writeFile(path, jsonl);
        const { service, requests, getPolls } = fixture();
        const result = await importAgentSessionPath(service, {
            path,
            corpusId: "corpus",
            sessionId: "session",
            importType,
            repository: "repo",
            commit: "commit",
            environment: "offline",
            pollIntervalMs: 1,
        });
        expect(result.state).toBe("complete");
        expect(result.cursor).toBe(1100);
        expect(requests.map((request) => request.jsonl).join("")).toBe(jsonl);
        expect(requests.length).toBeGreaterThan(2);
        expect(getPolls()).toBe(requests.length);
        expect(requests[requests.length - 1]?.final).toBe(true);
        for (const request of requests) {
            expect(Buffer.byteLength(request.jsonl)).toBeLessThanOrEqual(
                512 * 1024,
            );
            expect(
                request.jsonl.split("\n").filter(Boolean).length,
            ).toBeLessThanOrEqual(1000);
            expect(request).toMatchObject({
                importType,
                sessionId: "session",
                repository: "repo",
                commit: "commit",
                environment: "offline",
            });
            expect(request.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
        }
    },
);

test("native reader bounds short-line chunks, including an exact trailing newline", async () => {
    const path = resolve(scratch, "many-lines.jsonl");
    await writeFile(path, "{}\n".repeat(1001));
    const { service, requests } = fixture();
    await importAgentSessionPath(service, {
        path,
        corpusId: "corpus",
        sessionId: "session",
        importType: "agent-session-jsonl",
        pollIntervalMs: 1,
    });
    expect(requests.map((request) => request.jsonl)).toEqual([
        "{}\n".repeat(1000),
        "{}\n",
        "",
    ]);
    expect(requests.map((request) => request.expectedCursor)).toEqual([
        0, 1000, 1001,
    ]);
});

test("blank physical lines do not advance the record cursor", async () => {
    const path = resolve(scratch, "blank-lines.jsonl");
    await writeFile(path, " \t\r\n".repeat(1000) + "{}\n");
    const { service, requests } = fixture();
    await importAgentSessionPath(service, {
        path,
        corpusId: "corpus",
        sessionId: "session",
        importType: "agent-session-jsonl",
        pollIntervalMs: 1,
    });
    expect(requests.map((request) => request.expectedCursor)).toEqual([
        0, 0, 1,
    ]);
    expect(
        new Set(requests.map((request) => request.idempotencyKey)).size,
    ).toBe(3);
});

test("native reader refuses oversized files/lines and hard links before admitting content", async () => {
    const path = resolve(scratch, "oversized.jsonl");
    await writeFile(path, "é".repeat(262145));
    const { service, requests } = fixture();
    const options = {
        path,
        corpusId: "corpus",
        sessionId: "session",
        importType: "agent-session-jsonl" as const,
    };
    await expect(
        importAgentSessionPath(service, { ...options, maxTotalBytes: 10 }),
    ).rejects.toThrow("byte limit");
    await expect(importAgentSessionPath(service, options)).rejects.toThrow(
        "line exceeds",
    );
    const linked = resolve(scratch, "hard-link.jsonl");
    await link(path, linked);
    await expect(
        importAgentSessionPath(service, { ...options, path: linked }),
    ).rejects.toThrow("not a link");
    expect(requests).toEqual([]);
});

test("changing a file during submission prevents finalization", async () => {
    const path = resolve(scratch, "mutable.jsonl");
    await writeFile(path, "{}\n".repeat(1001));
    let changed = false;
    const { service, requests } = fixture(async () => {
        if (!changed) {
            changed = true;
            await appendFile(path, "{}\n");
        }
    });
    await expect(
        importAgentSessionPath(service, {
            path,
            corpusId: "corpus",
            sessionId: "session",
            importType: "agent-session-jsonl",
            pollIntervalMs: 1,
        }),
    ).rejects.toThrow("changed while reading");
    expect(requests.some((request) => request.final)).toBe(false);
});

test("missing optional capability fails explicitly without opening a path", async () => {
    await expect(
        importAgentSessionPath({} as MemoryService, {
            path: "not-read",
            corpusId: "corpus",
            sessionId: "session",
            importType: "agent-session-jsonl",
        }),
    ).rejects.toThrow("not supported");
});
