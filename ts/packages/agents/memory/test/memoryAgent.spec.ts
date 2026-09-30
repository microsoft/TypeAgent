// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
    ActionContext,
    ActionResult,
    ParameterDefinitions,
    ParsedCommandParams,
    SessionContext,
    Storage,
} from "@typeagent/agent-sdk";
import type {
    DocumentIngestRequest,
    MemoryEvidence,
    MemoryService,
} from "@typeagent/memory-service";
import {
    createStableSourceId,
    importMarkdownPath,
    isPathContained,
} from "../src/importer.js";
import { instantiate, type MemoryAgentContext } from "../src/memoryAgent.js";

const jest = import.meta.jest;
const scratch = resolve("test", ".memory-agent-test");
const importStoragePath = "memory-agent-import-batches.json";

function createEvidence(): MemoryEvidence {
    return {
        evidenceId: "evidence-1",
        corpusId: "corpus-1",
        sourceId: "source-1",
        revisionId: "revision-1",
        title: "Notes",
        snippet: "The launch date is Tuesday.",
        score: 0.9,
        sourceType: "markdown",
        indexedAt: "2026-01-01T00:00:00.000Z",
    };
}

function createFakeService(
    ingest: (request: DocumentIngestRequest) => Promise<{
        jobId: string;
        sourceId: string;
        revisionId: string;
        state: "accepted";
        statusUri: string;
    }> = async (request) => ({
        jobId: `job-${request.source.title}`,
        sourceId: request.source.sourceId ?? "generated",
        revisionId: "revision-1",
        state: "accepted",
        statusUri: "memory://job",
    }),
): MemoryService {
    return {
        createCorpus: async (name, description) => ({
            corpusId: "corpus-1",
            name,
            ...(description === undefined ? {} : { description }),
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            status: "ready",
            documentCount: 0,
        }),
        listCorpora: async () => [
            {
                corpusId: "corpus-1",
                name: "Test",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
                status: "ready",
                documentCount: 1,
            },
        ],
        getCorpus: async (corpusId) =>
            corpusId === "corpus-1"
                ? {
                      corpusId,
                      name: "Test",
                      createdAt: "2026-01-01T00:00:00.000Z",
                      updatedAt: "2026-01-01T00:00:00.000Z",
                      status: "ready",
                      documentCount: 1,
                      sourceCount: 1,
                      revisionCount: 1,
                      readyRevisionCount: 1,
                      failedRevisionCount: 0,
                      activeJobCount: 0,
                      indexVersion: "1",
                  }
                : undefined,
        clearCorpus: async () => 1,
        listSources: async () => [
            {
                corpusId: "corpus-1",
                sourceId: "source-1",
                sourceType: "markdown",
                title: "Notes",
                activeRevisionId: "revision-1",
                revisions: [
                    {
                        revisionId: "revision-1",
                        sourceId: "source-1",
                        contentHash: "hash",
                        mimeType: "text/markdown",
                        pipelineVersion: "1",
                        state: "ready",
                    },
                ],
            },
        ],
        listSourcesPage: async () => ({ items: [], total: 0 }),
        getSource: async () => undefined,
        getSourceContent: async () => ({
            corpusId: "corpus-1",
            sourceId: "source-1",
            revisionId: "revision-1",
            mimeType: "text/markdown",
            offset: 0,
            content: "",
            totalChars: 0,
            truncated: false,
        }),
        getSourceKnowledge: async () => ({
            entities: [],
            topics: [],
            relationships: [],
        }),
        ingestDocument: ingest,
        replaceSource: async () => ({
            jobId: "replace-job",
            sourceId: "source-1",
            revisionId: "revision-2",
            state: "accepted",
            statusUri: "memory://replace-job",
        }),
        previewForgetSource: async (corpusId, sourceId) => ({
            corpusId,
            sourceId,
            activeRevisionId: "revision-1",
            revisionCount: 1,
            derivedEntityCount: 0,
            derivedTopicCount: 0,
            derivedRelationshipCount: 0,
            confirmationToken: "forget-token",
            expiresAt: "2026-12-31T00:00:00.000Z",
        }),
        forgetSource: async ({ corpusId, sourceId }) => ({
            corpusId,
            sourceId,
            deletedRevisionCount: 1,
            indexVersion: "2",
        }),
        reindexCorpus: async (corpusId) => ({
            corpusId,
            sourceCount: 1,
            indexVersion: "2",
        }),
        reindexSource: async (corpusId, sourceId) => ({
            corpusId,
            sourceId,
            sourceCount: 1,
            indexVersion: "2",
        }),
        getJob: async () => undefined,
        listJobs: async () => ({
            items: [
                {
                    jobId: "job-1",
                    corpusId: "corpus-1",
                    sourceId: "source-1",
                    revisionId: "revision-1",
                    state: "complete",
                    progress: { completed: 1, total: 1 },
                    createdAt: "2026-01-01T00:00:00.000Z",
                    updatedAt: "2026-01-01T00:00:00.000Z",
                    warnings: [],
                },
            ],
            total: 1,
        }),
        cancelJob: async () => undefined,
        appendEvent: async (request) => ({
            event: {
                eventId: "event-1",
                corpusId: request.corpusId,
                idempotencyKey: request.idempotencyKey,
                producer: request.producer,
                eventType: request.eventType,
                sourceKind: request.sourceKind,
                observedAt: request.observedAt ?? "2026-01-01T00:00:00.000Z",
                eventTime:
                    request.eventTime ??
                    request.observedAt ??
                    "2026-01-01T00:00:00.000Z",
                createdAt: "2026-01-01T00:00:00.000Z",
            },
            replayed: false,
        }),
        getEvent: async () => undefined,
        listEvents: async () => ({ items: [], total: 0 }),
        searchEvents: async ({ query }) => ({ query, matches: [] }),
        forgetEvents: async ({ corpusId }) => ({
            corpusId,
            deletedEventCount: 0,
            deletedSourceCount: 0,
            retainedLinkedSourceIds: [],
            indexVersion: "1",
        }),
        search: async ({ query }) => ({
            query,
            matches: [createEvidence()],
            warnings: [],
            capabilitiesUsed: ["exactSearch"],
            indexVersion: "1",
        }),
        answer: async ({ question }) => ({
            question,
            answer: "The launch date is Tuesday.",
            citations: [createEvidence()],
            grounded: true,
            indexVersion: "1",
            warnings: [],
        }),
        getKnowledgeGraph: async () => ({
            entities: [],
            topics: [],
            relationships: [],
        }),
        getCapabilities: async () => ({
            features: {
                knowledgeExtraction: true,
                queryTranslation: false,
                vectorSimilarity: false,
                structuredSearch: true,
                exactSearch: true,
                management: true,
                groundedAnswer: true,
            },
            warnings: [],
        }),
    };
}

function commandParams(
    args: Record<string, unknown> = {},
    flags: Record<string, unknown> = {},
): ParsedCommandParams<ParameterDefinitions> {
    return { args, flags } as ParsedCommandParams<ParameterDefinitions>;
}

function actionContext(
    agentContext: MemoryAgentContext,
    storage?: Storage,
): ActionContext<unknown> {
    return {
        sessionContext: sessionContext(agentContext, storage),
    } as unknown as ActionContext<unknown>;
}

function sessionContext(
    agentContext: MemoryAgentContext,
    storage?: Storage,
): SessionContext<MemoryAgentContext> {
    return {
        agentContext,
        sessionStorage: storage,
    } as unknown as SessionContext<MemoryAgentContext>;
}

function memoryStorage(
    failWrite?: (path: string, value: string) => Error | undefined,
): { storage: Storage; values: Map<string, string> } {
    const values = new Map<string, string>();
    const storage = {
        exists: async (path: string) => values.has(path),
        read: async (path: string) => values.get(path) ?? "",
        write: async (path: string, value: string) => {
            const error = failWrite?.(path, value);
            if (error !== undefined) {
                throw error;
            }
            values.set(path, value);
        },
        delete: async (path: string) => {
            values.delete(path);
        },
        list: async () => [],
        getTokenCachePersistence: async () => ({
            load: async () => null,
            save: async () => undefined,
            delete: async () => false,
        }),
    } as unknown as Storage;
    return { storage, values };
}

function displayText(result: ActionResult | undefined): string {
    if (result === undefined || "error" in result) {
        return "";
    }
    const display = result.displayContent;
    if (display === undefined) {
        return "";
    }
    if (typeof display === "string") {
        return display;
    }
    if (Array.isArray(display)) {
        return display.flat().join("\n");
    }
    if ("content" in display) {
        return Array.isArray(display.content)
            ? display.content.flat().join("\n")
            : String(display.content);
    }
    return JSON.stringify(display);
}

beforeEach(async () => {
    await rm(scratch, { recursive: true, force: true });
    await mkdir(scratch, { recursive: true });
});

afterAll(async () => {
    await rm(scratch, { recursive: true, force: true });
});

test("path containment rejects sibling and parent paths", () => {
    const root = resolve(scratch, "root");
    expect(isPathContained(root, resolve(root, "notes", "a.md"))).toBe(true);
    expect(isPathContained(root, resolve(root, "..", "outside.md"))).toBe(
        false,
    );
    expect(isPathContained(root, `${root}-sibling`)).toBe(false);
});

test("stable source IDs use root and normalized relative path", () => {
    const root = resolve(scratch, "root");
    const first = createStableSourceId(root, "folder\\notes.md");
    const second = createStableSourceId(root, "folder/notes.md");
    expect(first).toBe(second);
    expect(createStableSourceId(root, "other.md")).not.toBe(first);
    expect(
        createStableSourceId(resolve(scratch, "other"), "folder/notes.md"),
    ).not.toBe(first);
});

test("import manifest preserves partial success and exact errors", async () => {
    await writeFile(resolve(scratch, "good.md"), "# Good", "utf8");
    await writeFile(resolve(scratch, "bad.md"), "# Bad", "utf8");
    const service = createFakeService(async (request) => {
        if (request.source.title === "bad.md") {
            throw new Error("rejected bad.md");
        }
        return {
            jobId: "good-job",
            sourceId: request.source.sourceId ?? "generated",
            revisionId: "revision-1",
            state: "accepted",
            statusUri: "memory://good-job",
        };
    });

    const manifest = await importMarkdownPath(service, {
        corpusId: "corpus-1",
        path: scratch,
        concurrency: 2,
    });

    expect(manifest.discovered).toBe(2);
    expect(manifest.accepted).toBe(1);
    expect(manifest.failed).toBe(1);
    expect(manifest.files).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                relativePath: "bad.md",
                error: "rejected bad.md",
            }),
            expect.objectContaining({
                relativePath: "good.md",
                jobId: "good-job",
            }),
        ]),
    );
});

test("recursive import applies root-relative include and exclude globs", async () => {
    await mkdir(resolve(scratch, "docs", "private"), { recursive: true });
    await writeFile(resolve(scratch, "docs", "public.md"), "# Public", "utf8");
    await writeFile(
        resolve(scratch, "docs", "private", "secret.md"),
        "# Secret",
        "utf8",
    );
    await writeFile(resolve(scratch, "ignored.md"), "# Ignored", "utf8");

    const manifest = await importMarkdownPath(createFakeService(), {
        corpusId: "corpus-1",
        path: scratch,
        recursive: true,
        include: ["docs/**/*.md"],
        exclude: ["**/private/**"],
    });

    expect(manifest.discovered).toBe(1);
    expect(manifest.files[0].relativePath).toBe("docs/public.md");
});

test("folder import is nonrecursive by default", async () => {
    await mkdir(resolve(scratch, "nested"), { recursive: true });
    await writeFile(resolve(scratch, "top.md"), "# Top", "utf8");
    await writeFile(resolve(scratch, "nested", "deep.md"), "# Deep", "utf8");

    const manifest = await importMarkdownPath(createFakeService(), {
        corpusId: "corpus-1",
        path: scratch,
    });

    expect(manifest.files.map((file) => file.relativePath)).toEqual(["top.md"]);
});

test("folder import enforces file and byte limits", async () => {
    await writeFile(resolve(scratch, "one.md"), "12345", "utf8");
    await writeFile(resolve(scratch, "two.md"), "67890", "utf8");
    const service = createFakeService();

    await expect(
        importMarkdownPath(service, {
            corpusId: "corpus-1",
            path: scratch,
            maxFiles: 1,
        }),
    ).rejects.toThrow("more than the 1 file limit");
    await expect(
        importMarkdownPath(service, {
            corpusId: "corpus-1",
            path: scratch,
            maxTotalBytes: 9,
        }),
    ).rejects.toThrow("exceeds the 9 byte limit");
});

test("import profiles map to service pipeline options and complete", async () => {
    await writeFile(resolve(scratch, "profile.md"), "# Profile", "utf8");
    const requests: DocumentIngestRequest[] = [];
    const service = createFakeService(async (request) => {
        requests.push(request);
        return {
            jobId: "profile-job",
            sourceId: request.source.sourceId ?? "generated",
            revisionId: "revision-1",
            state: "accepted",
            statusUri: "memory://profile-job",
        };
    });
    const { storage } = memoryStorage();
    const agent = instantiate();
    const state = (await agent.initializeAgentContext?.({
        options: service,
    })) as MemoryAgentContext;
    await agent.updateAgentContext?.(
        true,
        sessionContext(state, storage),
        "memory",
    );
    state.activeCorpusId = "corpus-1";

    await agent.executeCommand?.(
        ["import", "file"],
        commandParams(
            { path: resolve(scratch, "profile.md") },
            { profile: "deep" },
        ),
        actionContext(state, storage),
    );
    await [...state.imports.values()][0].promise;
    const completions = await agent.getCommandCompletion?.(
        ["import", "file"],
        commandParams(),
        ["profile"],
        sessionContext(state),
    );

    expect(requests[0].pipeline).toEqual({
        updatePolicy: "skipIfUnchanged",
        mode: "full",
        maxCharsPerChunk: 2_000,
    });
    expect(completions?.groups[0].completions).toEqual([
        "fast",
        "balanced",
        "deep",
    ]);

    const restored = (await agent.initializeAgentContext?.({
        options: service,
    })) as MemoryAgentContext;
    await agent.updateAgentContext?.(
        true,
        sessionContext(restored, storage),
        "memory",
    );
    const status = await agent.executeCommand?.(
        ["import", "status"],
        commandParams(),
        actionContext(restored, storage),
    );
    expect(displayText(status)).toContain('"profile": "deep"');
    expect(displayText(status)).toContain('"mode": "full"');
    expect(displayText(status)).toContain('"maxCharsPerChunk": 2000');
});

test("restoration rejects malformed JSON with its parse cause", async () => {
    const { storage, values } = memoryStorage();
    values.set(importStoragePath, "{");
    const agent = instantiate();
    const state = (await agent.initializeAgentContext?.({
        options: createFakeService(),
    })) as MemoryAgentContext;

    let error: unknown;
    try {
        await agent.updateAgentContext?.(
            true,
            sessionContext(state, storage),
            "memory",
        );
    } catch (caught: unknown) {
        error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
        "Invalid memory import storage: malformed JSON",
    );
    expect((error as Error & { cause: unknown }).cause).toBeInstanceOf(
        SyntaxError,
    );
    expect(state.imports.size).toBe(0);
});

test("restoration rejects an unsupported schema", async () => {
    const { storage, values } = memoryStorage();
    values.set(importStoragePath, JSON.stringify({ version: 2, batches: [] }));
    const agent = instantiate();
    const state = (await agent.initializeAgentContext?.({
        options: createFakeService(),
    })) as MemoryAgentContext;

    await expect(
        agent.updateAgentContext?.(
            true,
            sessionContext(state, storage),
            "memory",
        ),
    ).rejects.toThrow("Unsupported memory import storage version '2'");
    expect(state.imports.size).toBe(0);
});

test("restoration rejects invalid entries before merging valid ones", async () => {
    const { storage, values } = memoryStorage();
    values.set(
        importStoragePath,
        JSON.stringify({
            version: 1,
            batches: [
                {
                    batchId: "valid",
                    corpusId: "corpus-1",
                    profile: null,
                    pipeline: {
                        mode: "content",
                        maxCharsPerChunk: 8_000,
                    },
                    jobIds: [],
                },
                {},
            ],
        }),
    );
    const agent = instantiate();
    const state = (await agent.initializeAgentContext?.({
        options: createFakeService(),
    })) as MemoryAgentContext;

    await expect(
        agent.updateAgentContext?.(
            true,
            sessionContext(state, storage),
            "memory",
        ),
    ).rejects.toThrow("batch entry 1 is invalid");
    expect(state.imports.size).toBe(0);
});

test("accepted jobs are cancelled when durable tracking cannot be persisted", async () => {
    await writeFile(resolve(scratch, "persistence.md"), "# Persist", "utf8");
    const persistenceError = new Error("storage unavailable");
    const { storage } = memoryStorage((_path, value) =>
        value.includes("job-persistence.md") ? persistenceError : undefined,
    );
    const service = createFakeService();
    const cancelJob = jest.spyOn(service, "cancelJob");
    const agent = instantiate();
    const state = (await agent.initializeAgentContext?.({
        options: service,
    })) as MemoryAgentContext;
    await agent.updateAgentContext?.(
        true,
        sessionContext(state, storage),
        "memory",
    );
    state.activeCorpusId = "corpus-1";

    await agent.executeCommand?.(
        ["import", "file"],
        commandParams({ path: resolve(scratch, "persistence.md") }),
        actionContext(state, storage),
    );

    await expect([...state.imports.values()][0].promise).rejects.toThrow(
        "storage unavailable",
    );
    expect(cancelJob).toHaveBeenCalledWith("job-persistence.md");
});

test("commands retain corpus and extractive answer evidence", async () => {
    const service = createFakeService();
    const answerSpy = jest.spyOn(service, "answer");
    const agent = instantiate();
    const state = (await agent.initializeAgentContext?.({
        options: service,
    })) as MemoryAgentContext;
    const context = actionContext(state);

    await agent.executeCommand?.(
        ["corpus", "use"],
        commandParams({ corpusId: "corpus-1" }),
        context,
    );
    const answer = await agent.executeCommand?.(
        ["ask"],
        commandParams({ question: "When is launch?" }, { limit: 3 }),
        context,
    );
    const explanation = await agent.executeCommand?.(
        ["explain"],
        undefined,
        context,
    );

    expect(state.activeCorpusId).toBe("corpus-1");
    expect(answerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
            corpusId: "corpus-1",
            question: "When is launch?",
        }),
    );
    expect(displayText(answer)).toContain("Grounded extractive answer");
    expect(displayText(answer)).toContain("The launch date is Tuesday.");
    expect(displayText(answer)).toContain("source-1");
    expect(displayText(answer)).toContain("revision-1");
    expect(displayText(explanation)).toContain('"sourceId": "source-1"');
});

test("accepts agent-server options and completes service identifiers", async () => {
    const agent = instantiate();
    const state = (await agent.initializeAgentContext?.({
        options: { memoryServiceClient: createFakeService() },
    })) as MemoryAgentContext;
    state.activeCorpusId = "corpus-1";
    const context = sessionContext(state);
    await writeFile(resolve(scratch, "batch.md"), "# Batch", "utf8");
    await agent.executeCommand?.(
        ["import", "file"],
        commandParams({ path: resolve(scratch, "batch.md") }),
        actionContext(state),
    );
    await [...state.imports.values()][0].promise;

    const corpora = await agent.getCommandCompletion?.(
        ["corpus", "use"],
        commandParams(),
        ["corpusId"],
        context,
    );
    const sources = await agent.getCommandCompletion?.(
        ["sources", "show"],
        commandParams(),
        ["sourceId"],
        context,
    );
    const jobs = await agent.getCommandCompletion?.(
        ["jobs", "show"],
        commandParams(),
        ["jobId"],
        context,
    );
    const batches = await agent.getCommandCompletion?.(
        ["import", "cancel"],
        commandParams(),
        ["batchId"],
        context,
    );

    expect(corpora?.groups[0].completions).toEqual(["corpus-1", "Test"]);
    expect(sources?.groups[0].completions).toEqual(["source-1"]);
    expect(jobs?.groups[0].completions).toEqual(["job-1"]);
    expect(batches?.groups[0].completions).toHaveLength(1);
});

test("persists active corpus and durable import state without controllers", async () => {
    const { storage, values } = memoryStorage();
    await writeFile(resolve(scratch, "restore.md"), "# Restore", "utf8");
    const service = createFakeService();
    service.getJob = async (jobId) => ({
        jobId,
        corpusId: "corpus-1",
        sourceId: "source-1",
        revisionId: "revision-1",
        state: "building-indexes",
        progress: { completed: 1, total: 2 },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        warnings: [],
    });
    const agent = instantiate();
    const state = (await agent.initializeAgentContext?.({
        options: service,
    })) as MemoryAgentContext;
    await agent.updateAgentContext?.(
        true,
        sessionContext(state, storage),
        "memory",
    );

    await agent.executeCommand?.(
        ["corpus", "use"],
        commandParams({ corpusId: "Test" }),
        actionContext(state, storage),
    );
    await agent.executeCommand?.(
        ["import", "file"],
        commandParams({ path: resolve(scratch, "restore.md") }),
        actionContext(state, storage),
    );
    await [...state.imports.values()][0].promise;
    state.clearPreview = {
        corpusId: "corpus-1",
        confirmationToken: "must-not-persist",
        expiresAt: Date.now() + 1_000,
    };

    const restored = (await agent.initializeAgentContext?.({
        options: service,
    })) as MemoryAgentContext;
    await agent.updateAgentContext?.(
        true,
        sessionContext(restored, storage),
        "memory",
    );

    expect(restored.activeCorpusId).toBe("corpus-1");
    expect(restored.clearPreview).toBeUndefined();
    expect([...values.values()].join("\n")).not.toContain("must-not-persist");
    expect([...values.values()].join("\n")).not.toContain("controller");
    expect(restored.imports.size).toBe(1);
    const restoredBatch = [...restored.imports.values()][0];
    expect(restoredBatch.controller).toBeUndefined();
    expect([...restoredBatch.jobIds]).toEqual(["job-restore.md"]);

    const status = await agent.executeCommand?.(
        ["import", "status"],
        commandParams(),
        actionContext(restored, storage),
    );
    expect(displayText(status)).toContain('"state": "running"');
});

test("restored imports cancel durable jobs and report cancellation", async () => {
    const { storage } = memoryStorage();
    await writeFile(resolve(scratch, "cancel.md"), "# Cancel", "utf8");
    let jobState: "building-indexes" | "cancelled" = "building-indexes";
    const service = createFakeService();
    service.getJob = async (jobId) => ({
        jobId,
        corpusId: "corpus-1",
        sourceId: "source-1",
        revisionId: "revision-1",
        state: jobState,
        progress: { completed: 0, total: 1 },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        warnings: [],
    });
    const cancelJob = jest
        .spyOn(service, "cancelJob")
        .mockImplementation(async () => {
            jobState = "cancelled";
            return undefined;
        });
    const agent = instantiate();
    const initial = (await agent.initializeAgentContext?.({
        options: service,
    })) as MemoryAgentContext;
    await agent.updateAgentContext?.(
        true,
        sessionContext(initial, storage),
        "memory",
    );
    initial.activeCorpusId = "corpus-1";
    await agent.executeCommand?.(
        ["import", "file"],
        commandParams({ path: resolve(scratch, "cancel.md") }),
        actionContext(initial, storage),
    );
    await [...initial.imports.values()][0].promise;

    const restored = (await agent.initializeAgentContext?.({
        options: service,
    })) as MemoryAgentContext;
    await agent.updateAgentContext?.(
        true,
        sessionContext(restored, storage),
        "memory",
    );
    const batchId = [...restored.imports.keys()][0];
    await agent.executeCommand?.(
        ["import", "cancel"],
        commandParams({ batchId }),
        actionContext(restored, storage),
    );
    const status = await agent.executeCommand?.(
        ["import", "status"],
        commandParams({ batchId }),
        actionContext(restored, storage),
    );

    expect(cancelJob).toHaveBeenCalledWith("job-cancel.md");
    expect(displayText(status)).toContain('"state": "cancelled"');
});

test("cancel rejects a fully terminal batch without relabeling it", async () => {
    await writeFile(resolve(scratch, "complete.md"), "# Complete", "utf8");
    const service = createFakeService();
    service.getJob = async (jobId) => ({
        jobId,
        corpusId: "corpus-1",
        sourceId: "source-1",
        revisionId: "revision-1",
        state: "complete",
        progress: { completed: 1, total: 1 },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        warnings: [],
    });
    const cancelJob = jest.spyOn(service, "cancelJob");
    const agent = instantiate();
    const state = (await agent.initializeAgentContext?.({
        options: service,
    })) as MemoryAgentContext;
    state.activeCorpusId = "corpus-1";
    await agent.executeCommand?.(
        ["import", "file"],
        commandParams({ path: resolve(scratch, "complete.md") }),
        actionContext(state),
    );
    await [...state.imports.values()][0].promise;
    const batchId = [...state.imports.keys()][0];

    await expect(
        agent.executeCommand?.(
            ["import", "cancel"],
            commandParams({ batchId }),
            actionContext(state),
        ),
    ).rejects.toThrow("already terminal and cannot be cancelled");
    const status = await agent.executeCommand?.(
        ["import", "status"],
        commandParams({ batchId }),
        actionContext(state),
    );

    expect(cancelJob).not.toHaveBeenCalled();
    expect(displayText(status)).toContain('"state": "complete"');
});

test("status reports an independently cancelled job as partial", async () => {
    await writeFile(
        resolve(scratch, "external-cancel.md"),
        "# Cancelled",
        "utf8",
    );
    const service = createFakeService();
    service.getJob = async (jobId) => ({
        jobId,
        corpusId: "corpus-1",
        sourceId: "source-1",
        revisionId: "revision-1",
        state: "cancelled",
        progress: { completed: 0, total: 1 },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        warnings: [],
    });
    const agent = instantiate();
    const context = (await agent.initializeAgentContext?.({
        options: service,
    })) as MemoryAgentContext;
    context.activeCorpusId = "corpus-1";
    await agent.executeCommand?.(
        ["import", "file"],
        commandParams({ path: resolve(scratch, "external-cancel.md") }),
        actionContext(context),
    );
    await [...context.imports.values()][0].promise;
    const batchId = [...context.imports.keys()][0];

    const status = await agent.executeCommand?.(
        ["import", "status"],
        commandParams({ batchId }),
        actionContext(context),
    );

    expect(displayText(status)).toContain('"state": "partial"');
    expect(displayText(status)).toContain('"cancelledJobs": 1');
    expect(displayText(status)).toContain('"failedJobs": 0');
});

test("status separates cancelled, failed, partial, and missing jobs", async () => {
    for (const name of ["a.md", "b.md", "c.md", "d.md"]) {
        await writeFile(resolve(scratch, name), `# ${name}`, "utf8");
    }
    const service = createFakeService();
    service.getJob = async (jobId) => {
        let state: "cancelled" | "failed" | "partial" | undefined;
        switch (jobId) {
            case "job-a.md":
                state = "cancelled";
                break;
            case "job-b.md":
                state = "failed";
                break;
            case "job-c.md":
                state = "partial";
                break;
        }
        return state === undefined
            ? undefined
            : {
                  jobId,
                  corpusId: "corpus-1",
                  sourceId: "source-1",
                  revisionId: "revision-1",
                  state,
                  progress: { completed: 1, total: 1 },
                  createdAt: "2026-01-01T00:00:00.000Z",
                  updatedAt: "2026-01-01T00:00:00.000Z",
                  warnings: [],
              };
    };
    const agent = instantiate();
    const context = (await agent.initializeAgentContext?.({
        options: service,
    })) as MemoryAgentContext;
    context.activeCorpusId = "corpus-1";
    await agent.executeCommand?.(
        ["import", "folder"],
        commandParams({ path: scratch }),
        actionContext(context),
    );
    await [...context.imports.values()][0].promise;
    const batchId = [...context.imports.keys()][0];

    const status = await agent.executeCommand?.(
        ["import", "status"],
        commandParams({ batchId }),
        actionContext(context),
    );
    const text = displayText(status);

    expect(text).toContain('"state": "partial"');
    expect(text).toContain('"cancelledJobs": 1');
    expect(text).toContain('"failedJobs": 1');
    expect(text).toContain('"partialJobs": 1');
    expect(text).toContain('"missingJobs": 1');
});

test("corpus clear requires the matching preview token", async () => {
    const agent = instantiate();
    const state = (await agent.initializeAgentContext?.({
        options: createFakeService(),
    })) as MemoryAgentContext;
    state.activeCorpusId = "corpus-1";
    const context = actionContext(state);

    const preview = await agent.executeCommand?.(
        ["corpus", "clear"],
        commandParams(),
        context,
    );
    const match = displayText(preview).match(/"confirmationToken": "([^"]+)"/);
    expect(match).not.toBeNull();

    const cleared = await agent.executeCommand?.(
        ["corpus", "clear"],
        commandParams({}, { confirm: match?.[1] }),
        context,
    );
    expect(displayText(cleared)).toContain("Cleared 1 source");
});

test("corpus clear rejects an expired confirmation", async () => {
    const service = createFakeService();
    const clearCorpus = jest.spyOn(service, "clearCorpus");
    const agent = instantiate();
    const state = (await agent.initializeAgentContext?.({
        options: service,
    })) as MemoryAgentContext;
    state.activeCorpusId = "corpus-1";
    const context = actionContext(state);
    await agent.executeCommand?.(["corpus", "clear"], commandParams(), context);
    const token = state.clearPreview?.confirmationToken;
    if (state.clearPreview !== undefined) {
        state.clearPreview.expiresAt = 0;
    }

    await expect(
        agent.executeCommand?.(
            ["corpus", "clear"],
            commandParams({}, { confirm: token }),
            context,
        ),
    ).rejects.toThrow("Invalid or expired confirmation token");
    expect(clearCorpus).not.toHaveBeenCalled();
});

test("source replacement rejects stale file content", async () => {
    const replacementPath = resolve(scratch, "replacement.md");
    await writeFile(replacementPath, "# First", "utf8");
    const service = createFakeService();
    service.getSource = async () => (await service.listSources("corpus-1"))[0];
    const replaceSource = jest.spyOn(service, "replaceSource");
    const agent = instantiate();
    const state = (await agent.initializeAgentContext?.({
        options: service,
    })) as MemoryAgentContext;
    state.activeCorpusId = "corpus-1";
    const context = actionContext(state);
    const preview = await agent.executeCommand?.(
        ["sources", "replace"],
        commandParams({ sourceId: "source-1", path: replacementPath }),
        context,
    );
    const token = displayText(preview).match(
        /"confirmationToken": "([^"]+)"/,
    )?.[1];
    await writeFile(replacementPath, "# Changed", "utf8");

    await expect(
        agent.executeCommand?.(
            ["sources", "replace"],
            commandParams(
                { sourceId: "source-1", path: replacementPath },
                { confirm: token },
            ),
            context,
        ),
    ).rejects.toThrow("Invalid, expired, or stale confirmation");
    expect(replaceSource).not.toHaveBeenCalled();
});
