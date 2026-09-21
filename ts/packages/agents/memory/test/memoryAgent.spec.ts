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

const scratch = resolve("test", ".memory-agent-test");

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
            description,
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

function memoryStorage(): { storage: Storage; values: Map<string, string> } {
    const values = new Map<string, string>();
    const storage = {
        exists: async (path: string) => values.has(path),
        read: async (path: string) => values.get(path) ?? "",
        write: async (path: string, value: string) => {
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
    return typeof result.displayContent === "string"
        ? result.displayContent
        : Array.isArray(result.displayContent.content)
          ? result.displayContent.content.join("\n")
          : result.displayContent.content;
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

test("persists and restores only the active corpus", async () => {
    const { storage, values } = memoryStorage();
    const agent = instantiate();
    const state = (await agent.initializeAgentContext?.({
        options: createFakeService(),
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
    state.clearPreview = {
        corpusId: "corpus-1",
        confirmationToken: "must-not-persist",
        expiresAt: Date.now() + 1_000,
    };

    const restored = (await agent.initializeAgentContext?.({
        options: createFakeService(),
    })) as MemoryAgentContext;
    await agent.updateAgentContext?.(
        true,
        sessionContext(restored, storage),
        "memory",
    );

    expect(restored.activeCorpusId).toBe("corpus-1");
    expect(restored.clearPreview).toBeUndefined();
    expect([...values.values()].join("\n")).not.toContain("must-not-persist");
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
