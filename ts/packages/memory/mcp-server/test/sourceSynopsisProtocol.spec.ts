// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    InProcessMemoryServiceClient,
    McpMemoryServiceClient,
    sourceSchema,
    searchResultSchema,
    sourceSynopsisSchema,
} from "@typeagent/memory-client";
import {
    FileMemoryService,
    createMemoryServiceRpcFacade,
    type MemorySource,
    type SourceSynopsis,
    type SourceSynopsisRequest,
} from "@typeagent/memory-service";
import { MemoryServiceHost } from "../src/memoryServiceHost.js";

const detail: SourceSynopsis = {
    corpusId: "corpus",
    sourceId: "source",
    revisionId: "revision",
    status: "ready",
    freshness: "fresh",
    preview: "Local review, not rollout.",
    overview: "Local review completed; production rollout remains unapproved.",
    generatedVersion: 1,
    recipe: "source-synopsis-v1",
    inputHash: "semantic",
    generatedAt: "2026-10-12T18:00:00.000Z",
    evidence: [
        {
            coordinateSpace: "retained-utf16",
            start: 0,
            end: 12,
            excerpt: "Local review",
        },
    ],
    influenceSources: [{ sourceId: "source", revisionId: "revision" }],
    coverage: {
        method: "direct",
        scannedChars: 12,
        totalChars: 12,
        sectionCount: 1,
    },
    limitations: ["Generated navigation, not independent evidence."],
};
const source: MemorySource = {
    corpusId: "corpus",
    sourceId: "source",
    title: "Review",
    sourceType: "markdown",
    activeRevisionId: "revision",
    revisions: [
        {
            sourceId: "source",
            revisionId: "revision",
            contentHash: "hash",
            mimeType: "text/markdown",
            pipelineVersion: "1",
            state: "ready",
            synopsis: {
                status: detail.status,
                freshness: detail.freshness,
                preview: detail.preview!,
                generatedVersion: detail.generatedVersion,
                recipe: detail.recipe,
                inputHash: detail.inputHash,
            },
        },
    ],
};
class FixtureService extends FileMemoryService {
    override async getSource(): Promise<MemorySource> {
        return structuredClone(source);
    }
    override async listSources(): Promise<MemorySource[]> {
        return [structuredClone(source)];
    }
    override async listSourcesPage() {
        return { items: [structuredClone(source)], total: 1 };
    }
    override async getSourceSynopsis(
        request: SourceSynopsisRequest,
    ): Promise<SourceSynopsis> {
        if (request.revisionId && request.revisionId !== detail.revisionId)
            throw new Error("Unknown retained source revision");
        return structuredClone(detail);
    }
}

test("synopsis detail and lightweight previews survive actual in-process, RPC, MCP HTTP and Zod transports", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synopsis-protocol-"));
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
        const request = {
            corpusId: "corpus",
            sourceId: "source",
            revisionId: "revision",
        };
        expect(
            await new InProcessMemoryServiceClient(service).getSourceSynopsis(
                request,
            ),
        ).toEqual(detail);
        expect(
            await createMemoryServiceRpcFacade(service).getSourceSynopsis!(
                request,
            ),
        ).toEqual(detail);
        expect(await client.getSourceSynopsis(request)).toEqual(detail);
        expect(sourceSynopsisSchema.parse(detail)).toEqual(detail);
        expect(
            (await client.getSource("corpus", "source"))?.revisions[0].synopsis,
        ).toEqual(source.revisions[0].synopsis);
        expect(
            (await client.listSourcesPage({ corpusId: "corpus" })).items[0]
                .revisions[0].synopsis,
        ).toEqual(source.revisions[0].synopsis);
        expect(sourceSchema.parse(source).revisions[0].synopsis).toEqual(
            source.revisions[0].synopsis,
        );
        expect(
            searchResultSchema.parse({
                query: "local",
                matches: [
                    {
                        evidenceId: "e",
                        corpusId: "corpus",
                        sourceId: "source",
                        revisionId: "revision",
                        title: "Review",
                        snippet: "Local review",
                        score: 1,
                        sourceType: "markdown",
                        indexedAt: detail.generatedAt,
                        synopsis: source.revisions[0].synopsis,
                    },
                ],
                warnings: [],
                capabilitiesUsed: [],
                indexVersion: "v",
            }).matches[0].synopsis,
        ).toEqual(source.revisions[0].synopsis);
        await expect(
            client.getSourceSynopsis({ ...request, revisionId: "obsolete" }),
        ).rejects.toThrow("Unknown retained");
    } finally {
        await client.close();
        await host.close();
        await rm(root, { recursive: true, force: true });
    }
});

test("disabled hosts and missing optional capability return explicit errors, not empty success", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synopsis-disabled-"));
    const service = new FileMemoryService(root, {
        sourceSynopses: false,
        viewDrafts: false,
        informationalViews: false,
    });
    try {
        await expect(
            service.getSourceSynopsis({
                corpusId: "corpus",
                sourceId: "source",
            }),
        ).rejects.toThrow("explicitly disabled");
        const missing = new Proxy(service, {
            get(target, key, receiver) {
                return key === "getSourceSynopsis"
                    ? undefined
                    : Reflect.get(target, key, receiver);
            },
        });
        await expect(
            new InProcessMemoryServiceClient(missing).getSourceSynopsis({
                corpusId: "corpus",
                sourceId: "source",
            }),
        ).rejects.toThrow("not supported");
        await expect(
            createMemoryServiceRpcFacade(missing).getSourceSynopsis!({
                corpusId: "corpus",
                sourceId: "source",
            }),
        ).rejects.toThrow("source synopses");
    } finally {
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
});
