// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
    FileMemoryService,
    type FrameQueryRequest,
    type FrameQueryResult,
} from "@typeagent/memory-service";
import {
    InProcessMemoryServiceClient,
    McpMemoryServiceClient,
} from "@typeagent/memory-client";
import { MemoryServiceHost } from "../src/memoryServiceHost.js";

const schema: FrameQueryResult["schema"] = {
    id: "test.measurements",
    revision: 1,
    description: "Protocol fixture",
    fields: { duration: { type: "number", unit: "ms" } },
};
const status: Pick<
    FrameQueryResult,
    "version" | "snapshot" | "owners" | "coverage"
> = {
    version: 1,
    snapshot: "1".repeat(64),
    owners: [
        {
            ownerKey: "source:one",
            revisionId: "revision-one",
            fingerprint: "2".repeat(64),
            state: "ready",
        },
    ],
    coverage: { ready: 1, pending: 0, failed: 0, unavailableValues: 0 },
};
class FrameFixtureService extends FileMemoryService {
    public override async listFrameSchemas() {
        return [schema];
    }
    public override async getFrameProjectionStatus() {
        return status;
    }
    public override async queryFrame(
        request: FrameQueryRequest,
    ): Promise<FrameQueryResult> {
        if (
            request.schemaId !== schema.id ||
            request.schemaRevision !== schema.revision
        )
            throw new Error("Unknown frame schema revision");
        return {
            ...status,
            schema,
            predicate: request.predicate ?? { and: [] },
            rows: [
                {
                    schemaId: schema.id,
                    schemaRevision: 1,
                    itemKey: "sample-one",
                    values: { duration: 40 },
                    eligible: true,
                    origin: "source",
                    granularity: "record",
                    evidence: [
                        {
                            sourceId: "one",
                            revisionId: "revision-one",
                            locator: "chars:0-2",
                            excerpt: "40",
                        },
                    ],
                    opposition: [],
                    ownerKey: "source:one",
                    ownerRevisionId: "revision-one",
                    sourceIds: ["one"],
                },
            ],
        };
    }
}
test("frame catalog, predicates, evidence and readiness survive actual MCP HTTP", async () => {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "memory-frame-protocol-"),
    );
    const service = new FrameFixtureService(root, { frameProjections: true });
    const host = await MemoryServiceHost.start(service);
    const client = await McpMemoryServiceClient.create({
        kind: "http",
        url: host.endpoint,
        headers: { Authorization: `Bearer ${host.bearerToken}` },
    });
    try {
        const local = new InProcessMemoryServiceClient(service);
        const request = {
            corpusId: "corpus",
            schemaId: schema.id,
            schemaRevision: 1,
            predicate: {
                and: [
                    {
                        fieldId: "duration",
                        op: "gte" as const,
                        value: 30,
                        unit: "ms",
                    },
                ],
            },
        };
        expect(await client.listFrameSchemas("corpus")).toEqual(
            await local.listFrameSchemas("corpus"),
        );
        expect(await client.getFrameProjectionStatus("corpus")).toEqual(
            await local.getFrameProjectionStatus("corpus"),
        );
        expect(await client.queryFrame(request)).toEqual(
            await local.queryFrame(request),
        );
        expect((await client.getCapabilities()).features.dataFrames).toBe(true);
        await expect(
            client.queryFrame({ ...request, schemaRevision: 2 }),
        ).rejects.toThrow("Unknown frame schema");
        await expect(
            local.queryFrame({ ...request, schemaRevision: 2 }),
        ).rejects.toThrow("Unknown frame schema");
        await expect(
            client.queryFrame({ ...request, query: "also query" }),
        ).rejects.toThrow();
        await expect(
            local.queryFrame({ ...request, query: "also query" }),
        ).rejects.toThrow();
        await expect(client.listFrameSchemas("bad/id")).rejects.toThrow();
        await expect(local.listFrameSchemas("bad/id")).rejects.toThrow();
    } finally {
        await client.close();
        await host.close();
        await rm(root, { recursive: true, force: true });
    }
});
