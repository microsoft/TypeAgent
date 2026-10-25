// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    InProcessMemoryServiceClient,
    McpMemoryServiceClient,
    topicQueryPageSchema,
    viewBuildJobSchema,
} from "@typeagent/memory-client";
import {
    FileMemoryService,
    createMemoryServiceRpcFacade,
    createTopicSnapshot,
    indexedTopicOccurrence,
    queryTopicSnapshot,
    type TopicQueryRequest,
    type ViewBuildJob,
    type ViewBuildSnapshot,
} from "@typeagent/memory-service";
import { MemoryServiceHost } from "../src/memoryServiceHost.js";

const occurrences = Array.from({ length: 40 }, (_, n) =>
    indexedTopicOccurrence(
        {
            sourceId: `source-${n}`,
            revisionId: "original-r2",
            blockOrdinal: 0,
            text: "Original retained indexed text, not a synopsis.",
            score: 1,
        },
        "held lease",
        0,
    ),
);
const input: ViewBuildSnapshot = {
    corpusId: "corpus",
    actor: "offline-test",
    expectedVersion: 0,
    definition: {
        viewId: "topic-snapshot",
        kind: "wiki",
        selector: { kind: "sources", sources: [] },
        wiki: {
            construction: "informational-wiki-v1",
            query: "Complete topics",
            aliases: [],
            excludedSourceIds: [],
        },
    },
    bounds: {},
    inputs: [],
    pipeline: "topics-v1",
    model: "offline",
    fingerprint: "a".repeat(64),
    topicInput: { occurrences },
    influenceSources: occurrences.map(({ sourceId, revisionId }) => ({
        sourceId,
        revisionId,
    })),
};
const snapshot = createTopicSnapshot(input, input.model);
const job: ViewBuildJob = {
    jobId: randomUUID(),
    corpusId: "corpus",
    fingerprint: "b".repeat(64),
    request: {
        corpusId: "corpus",
        expectedHead: null,
        targets: [{ definition: input.definition, expectedVersion: 0 }],
    },
    actor: input.actor,
    createdAt: snapshot.generatedAt,
    updatedAt: snapshot.generatedAt,
    state: "complete",
    publication: false,
    results: [
        {
            viewId: "topic-snapshot",
            snapshot: input,
            state: "draft",
            topicGeneration: snapshot.generation,
            reason: "Complete topic snapshot, not an article",
        },
    ],
};

class FixtureService extends FileMemoryService {
    lastTopicQuery?: TopicQueryRequest;
    override async queryTopics(request: TopicQueryRequest) {
        this.lastTopicQuery = structuredClone(request);
        return queryTopicSnapshot(snapshot, request);
    }
    override async rebuildTopics(corpusId: string) {
        if (corpusId !== snapshot.corpusId) throw new Error("Wrong corpus");
        return structuredClone(job);
    }
}

test("complete topic input and bounded browsing survive actual in-process, RPC and MCP HTTP", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "topic-protocol-"));
    const service = new FixtureService(root, {
        viewDrafts: false,
        informationalViews: false,
    });
    const host = await MemoryServiceHost.start(service);
    const client = await McpMemoryServiceClient.create({
        kind: "http",
        url: host.endpoint,
        headers: { Authorization: `Bearer ${host.bearerToken}` },
    });
    try {
        const request = { corpusId: "corpus", pageSize: 1 };
        const expected = queryTopicSnapshot(snapshot, request);
        expect(
            await new InProcessMemoryServiceClient(service).queryTopics(
                request,
            ),
        ).toEqual(expected);
        expect(
            await createMemoryServiceRpcFacade(service).queryTopics(request),
        ).toEqual(expected);
        expect(await client.queryTopics(request)).toEqual(expected);
        const detail = {
            corpusId: "corpus",
            curated: true,
            topicId: "concept:one",
            summarize: true,
        };
        await client.queryTopics(detail);
        expect(service.lastTopicQuery).toEqual(detail);
        expect(topicQueryPageSchema.parse(expected)).toEqual(expected);
        const transported = await client.rebuildTopics("corpus");
        expect(transported).toEqual(job);
        expect(viewBuildJobSchema.parse(job)).toEqual(job);
        expect(
            transported.results[0].snapshot.topicInput?.occurrences,
        ).toHaveLength(40);
        expect(transported.results[0].snapshot.influenceSources).toHaveLength(
            40,
        );
        expect(transported.results[0].revisionId).toBeUndefined();
        expect(
            await client.queryTopics({
                ...request,
                continuationToken: expected.nextContinuationToken!,
            }),
        ).toEqual(
            queryTopicSnapshot(snapshot, {
                ...request,
                continuationToken: expected.nextContinuationToken!,
            }),
        );
        await expect(
            client.queryTopics({ ...request, pageSize: 201 }),
        ).rejects.toThrow();
    } finally {
        await client.close();
        await host.close();
        await rm(root, { recursive: true, force: true });
    }
});

test("missing optional topic capability is an explicit error", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "topic-unsupported-"));
    const service = new FileMemoryService(root, {
        viewDrafts: false,
        informationalViews: false,
    });
    const missing = new Proxy(service, {
        get(target, key, receiver) {
            return key === "queryTopics" || key === "rebuildTopics"
                ? undefined
                : Reflect.get(target, key, receiver);
        },
    });
    try {
        await expect(
            new InProcessMemoryServiceClient(missing).queryTopics({
                corpusId: "corpus",
            }),
        ).rejects.toThrow("not supported");
        await expect(
            createMemoryServiceRpcFacade(missing).rebuildTopics("corpus"),
        ).rejects.toThrow("not supported");
    } finally {
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
});
