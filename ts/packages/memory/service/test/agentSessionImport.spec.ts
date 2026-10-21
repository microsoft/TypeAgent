// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { AgentSessionStore } from "../src/agentSessionStore.js";
import type {
    AgentSessionDistillationModel,
    AgentSessionImportRequest,
} from "../src/agentSessionTypes.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";

const roots: string[] = [];
const services: FileMemoryService[] = [];

afterEach(async () => {
    for (const service of services.splice(0)) await service.close();
    for (const root of roots.splice(0))
        await rm(root, { recursive: true, force: true });
});

function open(root: string, model: AgentSessionDistillationModel) {
    const service = new FileMemoryService(root, {
        agentSessionDistillationModel: model,
        sourceSynopses: false,
        informationalViews: false,
        viewDrafts: false,
        indexFactory: (_corpusId, directory) =>
            new FakeSemanticCorpusIndex(directory),
    });
    services.push(service);
    return service;
}

async function setup(model: AgentSessionDistillationModel) {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-session-import-"));
    roots.push(root);
    const service = open(root, model);
    const { corpusId } = await service.createCorpus("Agent experience");
    return { root, service, corpusId };
}

function request(
    corpusId: string,
    id = "e1",
    cursor = 0,
): AgentSessionImportRequest & { repository: string; commit: string } {
    return {
        corpusId,
        sessionId: "test-session",
        importType: "agent-session-jsonl",
        idempotencyKey: `chunk-${cursor}`,
        expectedCursor: cursor,
        repository: "example/repo",
        commit: "abc123",
        jsonl:
            JSON.stringify({
                schemaVersion: 1,
                id,
                sessionId: "test-session",
                kind: "message",
                role: "user",
                text: "The repository uses pnpm test for focused checks.",
            }) + "\n",
    };
}

function output(eventId: string) {
    return JSON.stringify({
        memories: [
            {
                kind: "semantic",
                title: "Focused repository tests",
                body: "The user reports that this repository uses pnpm test; verify against the current checkout.",
                state: "diagnostic-only",
                eventIds: [eventId],
                supersedes: [],
            },
        ],
    });
}

async function settled(
    service: Pick<FileMemoryService, "getAgentSessionImport">,
    corpusId: string,
) {
    for (let attempt = 0; attempt < 400; attempt++) {
        const receipt = await service.getAgentSessionImport({
            corpusId,
            sessionId: "test-session",
        });
        if (receipt && receipt.state !== "running") return receipt;
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Agent session did not settle");
}

describe("opt-in long-running session import", () => {
    test("synthesizes a cross-chunk procedure with citations to both original episodes", async () => {
        let extractions = 0;
        let reductions = 0;
        const model: AgentSessionDistillationModel = {
            identity: "offline-cross-chunk",
            fits: () => true,
            complete: async (prompt) => {
                const memoryIds = Array.from(
                    prompt
                        .split("\n")
                        .at(-1)!
                        .matchAll(/"memoryId"\s*:\s*"([^"]+)"/g),
                    (match) => match[1],
                );
                if (memoryIds.length) {
                    reductions++;
                    return JSON.stringify({
                        memories: [
                            {
                                kind: "procedure",
                                title: "Focused validation workflow",
                                body: "1. Inspect current package scripts.\n2. Run pnpm test only if the selected script exists and current permissions allow it.",
                                state: "diagnostic-only",
                                memoryIds,
                                supersedes: [],
                            },
                        ],
                    });
                }
                const number = ++extractions;
                return JSON.stringify({
                    memories: [
                        {
                            kind: "semantic",
                            title: `Validation finding ${number}`,
                            body:
                                number === 1
                                    ? "Inspect current package scripts."
                                    : "The selected test script uses pnpm test.",
                            state: "diagnostic-only",
                            eventIds: [`e${number}`],
                            supersedes: [],
                        },
                    ],
                });
            },
        };
        const { service, corpusId } = await setup(model);
        for (let cursor = 0; cursor < 2; cursor++) {
            const input = request(corpusId, `e${cursor + 1}`, cursor);
            input.jsonl =
                JSON.stringify({
                    schemaVersion: 1,
                    id: `e${cursor + 1}`,
                    sessionId: input.sessionId,
                    kind: "decision",
                    taskId: "validation-task",
                    text:
                        cursor === 0
                            ? "Inspect current package scripts."
                            : "The selected test script uses pnpm test.",
                }) + "\n";
            input.final = cursor === 1;
            await service.importAgentSession(input);
            expect((await settled(service, corpusId)).state).toBe("complete");
        }
        expect(extractions).toBe(2);
        expect(reductions).toBe(1);
        const result = await service.searchAgentMemories({
            corpusId,
            query: "pnpm",
            repository: "example/repo",
            commit: "abc123",
        });
        const procedure = result.memories.find(
            (memory) => memory.kind === "procedure",
        );
        expect(procedure?.state).toBe("diagnostic-only");
        expect(
            new Set(procedure?.evidence.map((entry) => entry.eventId)),
        ).toEqual(new Set(["e1", "e2"]));
        expect(procedure?.influenceSourceIds).toHaveLength(2);
        expect(procedure?.supersedes).toEqual([]);
        expect(
            (
                await service.getAgentSessionImport({
                    corpusId,
                    sessionId: "test-session",
                })
            )?.memoryCount,
        ).toBe(3);
    });

    test("a failed final checkpoint retains the old cursor and cached extraction for exact retry", async () => {
        const root = await mkdtemp(
            path.join(os.tmpdir(), "agent-session-checkpoint-"),
        );
        roots.push(root);
        let checkpoints = 0;
        let calls = 0;
        let ingestions = 0;
        let checkpointFailed!: () => void;
        const failedCheckpoint = new Promise<void>((resolve) => {
            checkpointFailed = resolve;
        });
        const store = new AgentSessionStore(
            root,
            {
                ingestDocument: async () => {
                    ingestions++;
                    return {
                        jobId: "job",
                        sourceId: "source",
                        revisionId: "revision",
                        state: "complete",
                        statusUri: "job",
                    };
                },
                getJob: async () => ({
                    jobId: "job",
                    corpusId: "corpus",
                    sourceId: "source",
                    revisionId: "revision",
                    state: "complete",
                    progress: { completed: 1 },
                    createdAt: "2026-10-20",
                    updatedAt: "2026-10-20",
                    warnings: [],
                }),
                search: async () => ({
                    query: "pnpm",
                    matches: [],
                    warnings: [],
                    capabilitiesUsed: [],
                    indexVersion: "1",
                }),
                withEligible: async (_corpusId, _sources, operation) => {
                    if (++checkpoints === 4) {
                        checkpointFailed();
                        throw new Error("Injected final checkpoint failure");
                    }
                    await operation();
                },
            },
            () => ({
                identity: "offline-model",
                fits: () => true,
                complete: async () => {
                    calls++;
                    return output("e1");
                },
            }),
        );
        const adapter = { getAgentSessionImport: store.get.bind(store) };
        const input = request("corpus");
        try {
            await store.import(input);
            await failedCheckpoint;
            const failed = await settled(adapter, "corpus");
            expect(failed.state).toBe("failed");
            expect(failed.cursor).toBe(0);
            expect(failed.error).toContain("final checkpoint failure");
            await store.import(input);
            const completed = await settled(adapter, "corpus");
            expect(completed.state).toBe("complete");
            expect(completed.cursor).toBe(1);
            expect(calls).toBe(1);
            expect(ingestions).toBe(1);
        } finally {
            await store.close();
        }
    });

    test("retains, grounds and recalls scoped memory; unchanged replay and restart do not call the model", async () => {
        let calls = 0;
        const model: AgentSessionDistillationModel = {
            identity: "offline-model",
            fits: () => true,
            complete: async () => {
                calls++;
                return output("e1");
            },
        };
        const { root, service, corpusId } = await setup(model);
        const first = request(corpusId);
        const admitted = await service.importAgentSession(first);
        expect(admitted.state).toBe("running");
        const completed = await settled(service, corpusId);
        expect(completed.state).toBe("complete");
        expect(completed.cursor).toBe(1);
        expect(completed.memoryCount).toBe(1);
        const result = await service.searchAgentMemories({
            corpusId,
            query: "pnpm",
            repository: first.repository,
            commit: first.commit,
        });
        expect(result.memories).toHaveLength(1);
        const evidence = result.memories[0].evidence[0];
        const original = await service.getSourceContent({
            corpusId,
            sourceId: evidence.sourceId,
            revisionId: evidence.revisionId,
        });
        const [, start, end] = /^chars:(\d+)-(\d+)$/.exec(evidence.locator)!;
        expect(original.content.slice(Number(start), Number(end))).toBe(
            evidence.excerpt,
        );
        expect(evidence.eventId).toBe("e1");
        expect(
            (await service.searchAgentMemories({ corpusId, query: "pnpm" }))
                .memories,
        ).toEqual([]);
        expect(
            (
                await service.searchAgentMemories({
                    corpusId,
                    query: "pnpm",
                    repository: first.repository,
                    commit: "different",
                })
            ).warnings.length,
        ).toBeGreaterThan(0);
        await service.importAgentSession(first);
        expect(calls).toBe(1);
        await service.close();
        const reopened = open(root, model);
        await reopened.importAgentSession(first);
        expect(calls).toBe(1);
        expect((await reopened.getAgentSessionImport(first))?.cursor).toBe(1);
    });

    test("appends independent episodes and rejects changed identity, stale cursor and changed request key", async () => {
        let calls = 0;
        const model: AgentSessionDistillationModel = {
            identity: "offline-model",
            fits: () => true,
            complete: async () =>
                ++calls === 1 ? output("e1") : '{"memories":[]}',
        };
        const { service, corpusId } = await setup(model);
        await service.importAgentSession(request(corpusId));
        await settled(service, corpusId);
        await expect(
            service.importAgentSession({
                ...request(corpusId),
                jsonl: request(corpusId).jsonl + "\n",
            }),
        ).rejects.toThrow("idempotency");
        await expect(
            service.importAgentSession({
                ...request(corpusId, "e2"),
                idempotencyKey: "different",
            }),
        ).rejects.toThrow("cursor");
        const next = { ...request(corpusId, "e2", 1), final: true };
        await service.importAgentSession(next);
        expect((await settled(service, corpusId)).sourceCount).toBe(2);
        expect(calls).toBe(2);
        await expect(
            service.importAgentSession(request(corpusId, "e3", 2)),
        ).rejects.toThrow("finalized");
        expect(await service.listSources(corpusId)).toHaveLength(2);
    });

    test("failed distillation is explicit and retries an already indexed episode", async () => {
        let calls = 0;
        const model: AgentSessionDistillationModel = {
            identity: "offline-model",
            fits: () => true,
            complete: async () => {
                if (++calls === 1)
                    throw new Error("offline extraction failure");
                return output("e1");
            },
        };
        const { service, corpusId } = await setup(model);
        const input = request(corpusId);
        await service.importAgentSession(input);
        const failed = await settled(service, corpusId);
        expect(failed.state).toBe("failed");
        expect(failed.error).toContain("offline extraction failure");
        expect(failed.cursor).toBe(0);
        expect(await service.listSources(corpusId)).toHaveLength(1);
        await service.importAgentSession(input);
        expect((await settled(service, corpusId)).state).toBe("complete");
        expect(await service.listSources(corpusId)).toHaveLength(1);
        expect(calls).toBe(2);
    });

    test("malformed records are accounted for as partial, never lossless completion", async () => {
        const model: AgentSessionDistillationModel = {
            identity: "offline-model",
            fits: () => true,
            complete: async () => output("e1"),
        };
        const { service, corpusId } = await setup(model);
        await service.importAgentSession({
            ...request(corpusId),
            jsonl: request(corpusId).jsonl + "{bad-json}\n",
        });
        const result = await settled(service, corpusId);
        expect(result.state).toBe("partial");
        expect(result.losses).toHaveLength(1);
        expect(result.cursor).toBe(2);
    });

    test("forget invalidates all influenced memory and blocks a late model response and replay", async () => {
        let release!: (value: string) => void;
        let started!: () => void;
        const entered = new Promise<void>((resolve) => {
            started = resolve;
        });
        const response = new Promise<string>((resolve) => {
            release = resolve;
        });
        const model: AgentSessionDistillationModel = {
            identity: "offline-model",
            fits: () => true,
            complete: () => {
                started();
                return response;
            },
        };
        const { root, service, corpusId } = await setup(model);
        const input = request(corpusId);
        await service.importAgentSession(input);
        await entered;
        const source = (await service.listSources(corpusId))[0];
        const preview = await service.previewForgetSource(
            corpusId,
            source.sourceId,
        );
        await service.forgetSource({
            corpusId,
            sourceId: source.sourceId,
            confirmationToken: preview.confirmationToken,
        });
        release(output("e1"));
        expect(await service.getAgentSessionImport(input)).toBeUndefined();
        await expect(service.importAgentSession(input)).rejects.toThrow(
            "invalidated",
        );
        expect(
            (
                await service.searchAgentMemories({
                    corpusId,
                    query: "pnpm",
                    repository: input.repository,
                    commit: input.commit,
                })
            ).memories,
        ).toEqual([]);
        expect(
            await readdir(path.join(root, corpusId, "agent-sessions")),
        ).toEqual([]);
    });

    test.each(["clear", "replace", "suppress"] as const)(
        "%s removes the derived session checkpoint and prevents replay resurrection",
        async (operation) => {
            const model: AgentSessionDistillationModel = {
                identity: "offline-model",
                fits: () => true,
                complete: async () => output("e1"),
            };
            const { service, corpusId } = await setup(model);
            const input = request(corpusId);
            await service.importAgentSession(input);
            expect((await settled(service, corpusId)).state).toBe("complete");
            const source = (await service.listSources(corpusId))[0];
            if (operation === "clear") {
                await service.clearCorpus(corpusId);
            } else if (operation === "replace") {
                const job = await service.replaceSource({
                    corpusId,
                    sourceId: source.sourceId,
                    expectedActiveRevisionId: source.activeRevisionId!,
                    source: {
                        sourceType: "text",
                        title: "Replacement",
                        text: "A different source.",
                    },
                });
                expect((await waitForMemoryJob(service, job.jobId)).state).toBe(
                    "complete",
                );
            } else {
                await service.suppressSourceKnowledge({
                    corpusId,
                    sourceId: source.sourceId,
                    kind: "topic",
                    name: "pnpm",
                });
            }
            expect(await service.getAgentSessionImport(input)).toBeUndefined();
            await expect(service.importAgentSession(input)).rejects.toThrow(
                "invalidated",
            );
        },
    );

    test("explicit host disablement rejects imports and does not advertise the feature", async () => {
        const root = await mkdtemp(
            path.join(os.tmpdir(), "agent-session-disabled-"),
        );
        roots.push(root);
        const service = new FileMemoryService(root, {
            agentSessionImports: false,
            indexFactory: (_corpusId, directory) =>
                new FakeSemanticCorpusIndex(directory),
        });
        services.push(service);
        const { corpusId } = await service.createCorpus("Disabled");
        expect(
            (await service.getCapabilities()).features.agentSessionImportTypes,
        ).toEqual([]);
        await expect(
            service.importAgentSession(request(corpusId)),
        ).rejects.toThrow("disabled");
    });

    test("cancellation remains resumable even when the model ignores its abort signal", async () => {
        let entered!: () => void;
        let release!: (value: string) => void;
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        const response = new Promise<string>((resolve) => {
            release = resolve;
        });
        let calls = 0;
        const model: AgentSessionDistillationModel = {
            identity: "offline-model",
            fits: () => true,
            complete: async () => {
                if (++calls === 1) {
                    entered();
                    return response;
                }
                return output("e1");
            },
        };
        const { service, corpusId } = await setup(model);
        const input = request(corpusId);
        await service.importAgentSession(input);
        await started;
        const receipt = await service.cancelAgentSessionImport(input);
        expect(receipt.state).toBe("cancelled");
        expect(receipt.cursor).toBe(0);
        release(output("e1"));
        await service.importAgentSession(input);
        expect((await settled(service, corpusId)).state).toBe("complete");
        expect(calls).toBe(2);
    });

    test("ordinary document imports never invoke session learning", async () => {
        const model: AgentSessionDistillationModel = {
            identity: "must-not-run",
            fits: () => {
                throw new Error("not opted in");
            },
            complete: async () => {
                throw new Error("not opted in");
            },
        };
        const { service, corpusId } = await setup(model);
        const job = await service.ingestDocument({
            corpusId,
            source: {
                sourceType: "text",
                title: "Ordinary JSONL",
                text: request(corpusId).jsonl,
            },
        });
        await waitForMemoryJob(service, job.jobId);
        expect(
            (await service.searchAgentMemories({ corpusId, query: "pnpm" }))
                .memories,
        ).toEqual([]);
    });

    test("processes a 1002-event operation incrementally and retains evidence from its tail", async () => {
        let peakPromptChars = 0;
        const model: AgentSessionDistillationModel = {
            identity: "offline-long-session",
            fits: (prompt) => {
                peakPromptChars = Math.max(peakPromptChars, prompt.length);
                return prompt.length < 100_000;
            },
            complete: async (prompt) =>
                prompt.includes("FINAL_SENTINEL")
                    ? output("e1002")
                    : '{"memories":[]}',
        };
        const { service, corpusId } = await setup(model);
        for (let chunk = 0; chunk < 2; chunk++) {
            const events = Array.from({ length: 501 }, (_, index) => {
                const number = chunk * 501 + index + 1;
                return JSON.stringify({
                    schemaVersion: 1,
                    id: `e${number}`,
                    sessionId: "test-session",
                    kind: "message",
                    role: "user",
                    taskId: "long-task",
                    text:
                        number === 1002
                            ? "FINAL_SENTINEL: The repository uses pnpm test for focused checks."
                            : `Observation ${number}: inspect the current package scripts before selecting a test.`,
                });
            });
            await service.importAgentSession({
                ...request(corpusId),
                expectedCursor: chunk * 501,
                idempotencyKey: `long-${chunk}`,
                jsonl: events.join("\n") + "\n",
                final: chunk === 1,
            });
            const receipt = await settled(service, corpusId);
            expect(receipt.state).toBe("complete");
            expect(receipt.cursor).toBe((chunk + 1) * 501);
        }
        const recalled = await service.searchAgentMemories({
            corpusId,
            query: "FINAL_SENTINEL",
            repository: "example/repo",
            commit: "abc123",
        });
        expect(recalled.memories).toHaveLength(1);
        expect(recalled.memories[0].evidence[0].eventId).toBe("e1002");
        expect(peakPromptChars).toBeGreaterThan(0);
        expect(peakPromptChars).toBeLessThan(100_000);
    });
});
