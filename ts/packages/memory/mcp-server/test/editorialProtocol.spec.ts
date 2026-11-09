// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    InProcessMemoryServiceClient,
    McpMemoryServiceClient,
    viewSaveRequestSchema,
} from "@typeagent/memory-client";
import {
    FileMemoryService,
    createMemoryServiceRpcFacade,
    type ViewVersion,
    type ViewSaveRequest,
    type ViewReadRequest,
} from "@typeagent/memory-service";
import { MemoryServiceHost } from "../src/memoryServiceHost.js";

const content: ViewVersion["content"] = {
    kind: "wiki",
    construction: "informational-wiki-v1",
    title: "Human title",
    summary: "Selected original indexed evidence only",
    citations: [],
    index: [
        {
            pageId: "article",
            title: "Current original evidence",
            taxonomy: "concept",
        },
    ],
    sections: [
        {
            id: "article",
            role: "page",
            heading: "Current original evidence",
            body: "Local acceptance is not rollout approval",
            details: {
                kind: "page",
                construction: "informational-wiki-v1",
                taxonomy: "concept",
                note: "Human annotation",
                mergedPageIds: [],
            },
        },
    ],
};
const view: ViewVersion = {
    corpusId: "corpus",
    viewId: "article",
    revisionId: "current",
    version: 2,
    state: "draft",
    createdAt: "offline",
    actor: "authenticated-owner",
    provenance: "human",
    content,
    relationships: [],
    definition: {
        viewId: "article",
        revisionId: "definition",
        kind: "wiki",
        selector: { kind: "sources", sources: [] },
        wiki: {
            construction: "informational-wiki-v1",
            query: "current evidence",
            aliases: [],
            excludedSourceIds: [],
        },
    },
    generation: {
        candidateId: "base",
        fingerprint: "a".repeat(64),
        content: { ...content, title: "Generated title" },
    },
    edits: [
        {
            id: "6a5907de-c782-4baf-9a99-ebc936ca4336",
            target: "title",
            actor: "authenticated-owner",
            createdAt: "offline",
            oldHash: "b".repeat(64),
            operation: "set",
            status: "active",
            protection: ["title"],
            unlockedTargets: [],
        },
    ],
    relatedArticles: [
        {
            viewId: "related",
            revisionId: "related-current",
            title: "Related current original source",
        },
    ],
    protectedTargets: ["title"],
};
const request: ViewSaveRequest = {
    corpusId: view.corpusId,
    viewId: view.viewId,
    expectedVersion: view.version,
    expectedHead: "c".repeat(40),
    definition: {
        viewId: view.viewId,
        kind: "wiki",
        selector: view.definition.selector,
        wiki: view.definition.wiki!,
    },
    content,
    relationships: [],
    unlockProtection: ["title"],
};
if (!view.generation)
    throw new Error("Editorial transport fixture requires a generated base");
view.generation.input = {
    corpusId: view.corpusId,
    actor: "memory-view-generator",
    definition: request.definition,
    expectedVersion: 1,
    bounds: {},
    inputs: [],
    pipeline: "informational-wiki-v1",
    model: "offline",
    fingerprint: "d".repeat(64),
    editorial: {
        generatedBaseId: view.generation.candidateId,
        targetRevisionId: view.revisionId,
        generatedBase: { content: view.generation.content, relationships: [] },
        protectedTargets: ["title"],
        unlockedTargets: [],
    },
};

class EditorialTransportFixture extends FileMemoryService {
    saved: ViewSaveRequest[] = [];
    override async getView(input: ViewReadRequest) {
        if (input.viewId !== view.viewId)
            throw new Error("Wrong editorial identity");
        return structuredClone(view);
    }
    override async saveViewDraft(input: ViewSaveRequest) {
        this.saved.push(structuredClone(input));
        return { commitId: "c".repeat(40), version: structuredClone(view) };
    }
}

test("existing MCP/in-process/RPC save route retains explicit unlock and authenticated edit/read metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "editorial-protocol-"));
    const service = new EditorialTransportFixture(root, {
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
        const direct = new InProcessMemoryServiceClient(service);
        const rpc = createMemoryServiceRpcFacade(service);
        for (const transport of [direct, rpc, client]) {
            expect(
                await transport.getView({
                    corpusId: "corpus",
                    viewId: "article",
                }),
            ).toEqual(view);
            expect((await transport.saveViewDraft(request)).version).toEqual(
                view,
            );
        }
        expect(service.saved).toEqual([request, request, request]);
        expect(
            viewSaveRequestSchema.safeParse({
                ...request,
                actor: "memory-view-generator",
            }).success,
        ).toBe(false);
        expect(
            viewSaveRequestSchema.safeParse({
                ...request,
                unlockProtection: [],
            }).success,
        ).toBe(false);
    } finally {
        await client.close();
        await host.close();
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
});
