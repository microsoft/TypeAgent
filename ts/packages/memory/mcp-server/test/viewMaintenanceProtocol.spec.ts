// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { McpMemoryServiceClient } from "@typeagent/memory-client";
import { FileMemoryService } from "@typeagent/memory-service";
import {
    viewBuildRequestSchema,
    viewMaintenanceDefinitionSchema,
} from "@typeagent/memory-client/view-protocol";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MemoryServiceHost } from "../src/memoryServiceHost.js";

test("authenticated MCP rejects obsolete wiki requests and preserves family controls", async () => {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "memory-wiki-rejection-wire-"),
    );
    const service = new FileMemoryService(root);
    const host = await MemoryServiceHost.start(service);
    const client = await McpMemoryServiceClient.create({
        kind: "http",
        url: host.endpoint,
        headers: { authorization: `Bearer ${host.bearerToken}` },
    });
    try {
        const corpusId = (await client.createCorpus("Wire wiki")).corpusId;
        const request = {
            corpusId,
            expectedHead: null,
            targets: [
                {
                    expectedVersion: 0,
                    definition: {
                        viewId: "wiki",
                        kind: "wiki" as const,
                        selector: {
                            kind: "sources" as const,
                            sources: [{ sourceId: "s", revisionId: "r" }],
                        },
                    },
                },
            ],
        };
        expect(viewBuildRequestSchema.safeParse(request).success).toBe(false);
        await expect(client.buildViews(request)).rejects.toThrow();
        expect(
            viewMaintenanceDefinitionSchema.safeParse({
                schemaVersion: 1,
                scope: { mode: "pinned" },
                wikiDiscovery: {
                    rules: "explicit-subjects-v1",
                    createDraftPages: true,
                    subjects: [],
                },
            }).success,
        ).toBe(false);
        const indexed = structuredClone(request);
        Object.assign(indexed.targets[0].definition, {
            wiki: {
                construction: "informational-wiki-v1",
                query: "payments",
                aliases: [],
                excludedSourceIds: [],
            },
        });
        expect(viewBuildRequestSchema.safeParse(indexed).success).toBe(true);
        const snapshot = await client.listViews(corpusId);
        const paused = await client.maintainViews({
            corpusId,
            expectedHead: snapshot.head,
            family: "wiki",
            operation: "pause",
        });
        expect(paused.job).toBeUndefined();
        expect((await client.listViews(corpusId)).wikiFamily?.enabled).toBe(
            false,
        );
        const current = await client.listViews(corpusId);
        await client.maintainViews({
            corpusId,
            expectedHead: current.head,
            family: "projects",
            operation: "pause",
        });
        expect((await client.listViews(corpusId)).projectFamily).toMatchObject({
            enabled: false,
            pending: true,
        });
        expect(
            (await client.getCapabilities()).derivedViews
                ?.informationalProjects,
        ).toBe(true);
    } finally {
        await client.close();
        await host.close();
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
});
