// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { inspect } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
    InProcessMemoryServiceClient,
    McpMemoryServiceClient,
    schemaViewToolNames,
    acquisitionToolNames,
    projectAcquisitionProgress,
    inventoryToolNames,
    inventoryPageRequestSchema,
    viewPublicationBatchRequestSchema,
} from "@typeagent/memory-client";
import {
    FileMemoryService,
    type AcquisitionRequest,
    type QuestionInventory,
    type QuestionReadRequest,
    type QuestionEditRequest,
    type SchemaViewPageRequest,
    type SchemaViewProposalRequest,
    type SchemaQuestionDiscoveryRequest,
    type ViewVersion,
    type ViewReadRequest,
    type ViewSourceUsageRequest,
    type MemoryService,
} from "@typeagent/memory-service";
import { MemoryServiceHost } from "../src/memoryServiceHost.js";

const view = JSON.parse(
    readFileSync(
        new URL("../../../client/test/schemaViewFixture.json", import.meta.url),
        "utf8",
    ),
) as ViewVersion;
const schema = view.definition.schemaView!;
const details =
    view.content.kind === "schemaView"
        ? view.content.sections[0].details
        : undefined;
const inventory: QuestionInventory = {
    head: null,
    items: [
        {
            corpusId: "corpus",
            viewId: "profile",
            viewTitle: "Profile",
            viewVersion: 1,
            viewRevisionId: view.revisionId,
            definitionRevision: "contract",
            slot: schema.slots[0],
            details: details!,
            attentionScore: 10,
            fingerprint: "fingerprint",
        },
    ],
    maintenanceError: "Evaluation pending",
};
const acquisition: AcquisitionRequest = {
    corpusId: "corpus",
    principalId: "PRIVATE",
    policyId: "PRIVATE",
    toolId: "PRIVATE",
    resourceIdentity: "PRIVATE",
    scopeFingerprint: "scope",
    authorizedArguments: { query: "PRIVATE" },
    consumers: [
        { viewId: "profile", slotId: "name", definitionRevision: "contract" },
    ],
    lineage: { rootId: "root", maxCalls: 1 },
    requestId: "request",
    sourceId: "source",
    identity: "identity",
    lineageIdentity: "lineage",
    state: "ingested",
    createdAt: "now",
    updatedAt: "now",
    calls: 1,
    retries: 0,
    fence: 0,
    error: "PRIVATE",
    staged: {
        corpusId: "corpus",
        source: { sourceType: "text", title: "PRIVATE", text: "PRIVATE" },
    },
    receipt: {
        jobId: "job",
        sourceId: "source",
        revisionId: "revision",
        state: "complete",
        statusUri: "PRIVATE",
    },
};
const entry = { commitId: "a".repeat(40), version: view };
class SchemaFixtureService extends FileMemoryService {
    public calls: unknown[] = [];
    public failRun = false;
    override async listViews(_corpusId: string) {
        return { head: null, views: [view] };
    }
    override async getView(_request: ViewReadRequest) {
        return view;
    }
    override async getSourceViewUsage(_request: ViewSourceUsageRequest) {
        return {
            items: [
                {
                    viewId: view.viewId,
                    revisionId: view.revisionId,
                    version: 1,
                    kind: "schemaView" as const,
                    title: "Profile",
                    state: "draft" as const,
                    provenance: "human" as const,
                },
            ],
            total: 1,
        };
    }
    override async listQuestions(_corpusId: string) {
        return inventory;
    }
    override async getQuestion(request: QuestionReadRequest) {
        return inventory.items.find(
            (item) =>
                item.corpusId === request.corpusId &&
                item.viewId === request.viewId &&
                item.slot.id === request.slotId,
        );
    }
    override async editQuestion(request: QuestionEditRequest) {
        this.calls.push(request);
        return entry;
    }
    override async getViewPage(request: SchemaViewPageRequest) {
        this.calls.push(request);
        return {
            uri: "memory-view://corpus/profile?slotId=name&revisionId=view-revision",
            revisionId: "view-revision",
            markdown: "# Profile\n\n[[Name]]",
        };
    }
    override async proposeSchemaView(request: SchemaViewProposalRequest) {
        this.calls.push(request);
        return entry;
    }
    override async discoverSchemaQuestions(
        request: SchemaQuestionDiscoveryRequest,
    ) {
        this.calls.push(request);
        return entry;
    }
    override async listAcquisitions(_corpusId: string) {
        return [acquisition];
    }
    override async runAcquisitions(_corpusId: string) {
        if (this.failRun) throw new Error("PRIVATE outbound query");
        return [acquisition];
    }
    override async cancelAcquisition(request: {
        corpusId: string;
        requestId: string;
    }) {
        this.calls.push(request);
        return { ...acquisition, state: "cancelled" as const };
    }
}

test("schema questions, generic views and sanitized acquisition operations survive actual MCP HTTP", async () => {
    const root = path.resolve(
        process.cwd(),
        `.schema-protocol-${randomUUID()}`,
    );
    const service = new SchemaFixtureService(root);
    const hostErrors: Error[] = [];
    const host = await MemoryServiceHost.start(service, {
        onError: (error) => hostErrors.push(error),
    });
    const client = await McpMemoryServiceClient.create({
        kind: "http",
        url: host.endpoint,
        headers: { Authorization: `Bearer ${host.bearerToken}` },
    }).catch((cause) => {
        throw Object.assign(new Error("Typed client connection failed"), {
            cause,
        });
    });
    const raw = new Client({ name: "offline-schema", version: "1" });
    await raw
        .connect(
            new StreamableHTTPClientTransport(new URL(host.endpoint), {
                requestInit: {
                    headers: {
                        Authorization: `Bearer ${host.bearerToken}`,
                    },
                },
            }) as Transport,
        )
        .catch((cause) => {
            throw Object.assign(new Error("Raw client connection failed"), {
                cause,
            });
        });
    let stage = "generic views";
    try {
        const local = new InProcessMemoryServiceClient(service);
        expect((await client.getCapabilities()).derivedViews?.kinds).toContain(
            "schemaView",
        );
        expect(await client.listViews("corpus")).toEqual(
            await local.listViews("corpus"),
        );
        expect(
            await client.getView({
                corpusId: "corpus",
                viewId: "profile",
                revisionId: "view-revision",
            }),
        ).toEqual(view);
        expect(
            (
                await client.getSourceViewUsage({
                    corpusId: "corpus",
                    sourceId: "source",
                })
            ).items[0].kind,
        ).toBe("schemaView");
        stage = "question operations";
        expect(await client.listQuestions("corpus")).toEqual(
            await local.listQuestions("corpus"),
        );
        const summaryRequest = { corpusId: "corpus", pageSize: 1 };
        const summaries = await client.listQuestionSummaries(summaryRequest);
        expect(summaries).toEqual(
            await local.listQuestionSummaries(summaryRequest),
        );
        expect(summaries.items[0].details).not.toHaveProperty("candidates");
        expect(summaries.items[0].slot).not.toHaveProperty(
            "discoveryCitations",
        );
        expect(summaries.maintenanceError).toBe(inventory.maintenanceError);
        const detailRequest = {
            corpusId: "corpus",
            viewId: "profile",
            slotId: schema.slots[0].id,
        };
        expect(await client.getQuestion(detailRequest)).toEqual(
            await local.getQuestion(detailRequest),
        );
        for (const pageSize of [0, 101, 1.5]) {
            expect(
                (
                    await raw.callTool({
                        name: inventoryToolNames.listQuestionSummaries,
                        arguments: { corpusId: "corpus", pageSize },
                    })
                ).isError,
            ).toBe(true);
        }
        const pageRequest = {
            corpusId: "corpus",
            viewId: "profile",
            slotId: "name",
            itemKey: "home",
            revisionId: "view-revision",
        };
        expect(await client.getViewPage(pageRequest)).toEqual(
            await local.getViewPage(pageRequest),
        );
        const base = {
            corpusId: "corpus",
            viewId: "profile",
            expectedHead: null,
            expectedVersion: 1,
        };
        const edit: QuestionEditRequest = {
            ...base,
            slotId: "name",
            edit: { kind: "discovery", enabled: true, maxProposals: 8 },
        };
        expect(await client.editQuestion(edit)).toEqual(
            await local.editQuestion(edit),
        );
        const proposal: SchemaViewProposalRequest = {
            ...base,
            specification: "Propose a name form; this is not a fact",
            maintenance: { schemaVersion: 1, scope: { mode: "pinned" } },
        };
        expect(await client.proposeSchemaView(proposal)).toEqual(
            await local.proposeSchemaView(proposal),
        );
        expect(await client.discoverSchemaQuestions(base)).toEqual(
            await local.discoverSchemaQuestions(base),
        );
        expect(service.calls).toContainEqual(edit);
        expect(service.calls).toContainEqual(proposal);
        stage = "safe acquisitions";
        const expected = [projectAcquisitionProgress(acquisition)];
        expect(await client.listAcquisitionProgress("corpus")).toEqual(
            expected,
        );
        expect(await local.listAcquisitionProgress("corpus")).toEqual(expected);
        expect(await client.runAcquisitionProgress("corpus")).toEqual(expected);
        expect(
            await client.cancelAcquisitionProgress({
                corpusId: "corpus",
                requestId: "request",
            }),
        ).toEqual({ ...expected[0], state: "cancelled" });
        stage = "raw tools";
        await verifySafeTools(raw, service);
    } catch (cause) {
        throw new Error(
            `${stage}: ${inspect([cause, ...hostErrors], { depth: 5 })}`,
        );
    } finally {
        await raw.close();
        await client.close();
        await host.close();
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
}, 30000);

async function verifySafeTools(raw: Client, service: SchemaFixtureService) {
    const tools = await raw.listTools().catch((cause) => {
        throw new AggregateError([cause], "Listing MCP tools failed");
    });
    const names = tools.tools.map((tool) => tool.name);
    for (const name of [
        ...Object.values(schemaViewToolNames),
        ...Object.values(acquisitionToolNames),
    ])
        expect(names).toContain(name);
    expect(
        names.some((name) =>
            /acquisition.*request|acquisition.*periodic/.test(name),
        ),
    ).toBe(false);
    const result = await raw
        .callTool({
            name: acquisitionToolNames.listAcquisitionProgress,
            arguments: { corpusId: "corpus" },
        })
        .catch((cause) => {
            throw Object.assign(
                new Error("Listing acquisition progress failed"),
                { cause },
            );
        });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    const invalid = await raw
        .callTool({
            name: acquisitionToolNames.runAcquisitionProgress,
            arguments: {
                corpusId: "corpus",
                authorizedArguments: { query: "unauthorized" },
            },
        })
        .catch((cause) => {
            throw Object.assign(
                new Error(
                    "Rejecting unauthorized acquisition arguments failed",
                ),
                { cause },
            );
        });
    expect(invalid.isError).toBe(true);
    service.failRun = true;
    const failed = await raw
        .callTool({
            name: acquisitionToolNames.runAcquisitionProgress,
            arguments: { corpusId: "corpus" },
        })
        .catch((cause) => {
            throw Object.assign(
                new Error("Reporting acquisition failure failed"),
                { cause },
            );
        });
    expect(failed.isError).toBe(true);
    expect(JSON.stringify(failed)).not.toContain("PRIVATE");
}

test("missing optional question and acquisition capabilities fail explicitly", async () => {
    const client = new InProcessMemoryServiceClient({} as MemoryService);
    await expect(client.listQuestions("corpus")).rejects.toThrow(
        "not supported",
    );
    await expect(
        client.listViewSummaries({ corpusId: "corpus" }),
    ).rejects.toThrow("not supported");
    await expect(
        client.listQuestionSummaries({ corpusId: "corpus" }),
    ).rejects.toThrow("not supported");
    await expect(
        client.listViewBuildSummaries({ corpusId: "corpus" }),
    ).rejects.toThrow("not supported");
    await expect(
        client.getViewPublications({ corpusId: "corpus", viewIds: [] }),
    ).rejects.toThrow("not supported");
    await expect(
        client.getQuestion({
            corpusId: "corpus",
            viewId: "profile",
            slotId: "name",
        }),
    ).rejects.toThrow("not supported");
    await expect(
        client.getViewPage({ corpusId: "corpus", viewId: "profile" }),
    ).rejects.toThrow("not supported");
    await expect(client.listAcquisitionProgress("corpus")).rejects.toThrow(
        "unavailable",
    );
    expect("requestAcquisition" in client).toBe(false);
    expect("startAcquisitionPeriodic" in client).toBe(false);
});

test("inventory input contracts reject unbounded pages and duplicate publication identities", () => {
    for (const pageSize of [0, -1, 101, 1.5])
        expect(
            inventoryPageRequestSchema.safeParse({
                corpusId: "corpus",
                pageSize,
            }).success,
        ).toBe(false);
    expect(
        inventoryPageRequestSchema.safeParse({
            corpusId: "corpus",
            pageSize: 100,
            continuationToken: "25",
        }).success,
    ).toBe(true);
    expect(
        inventoryPageRequestSchema.safeParse({
            corpusId: "corpus",
            continuationToken: "-1",
        }).success,
    ).toBe(false);
    expect(
        inventoryPageRequestSchema.safeParse({
            corpusId: "corpus",
            unexpected: true,
        }).success,
    ).toBe(false);
    expect(
        viewPublicationBatchRequestSchema.safeParse({
            corpusId: "corpus",
            viewIds: ["same", "same"],
        }).success,
    ).toBe(false);
    expect(
        viewPublicationBatchRequestSchema.safeParse({
            corpusId: "corpus",
            viewIds: Array.from({ length: 101 }, (_, index) => `view-${index}`),
        }).success,
    ).toBe(false);
});
