// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    FileMemoryService,
    type ViewBuildJob,
} from "@typeagent/memory-service";
import { McpMemoryServiceClient } from "@typeagent/memory-client";
import { MemoryServiceHost } from "../src/memoryServiceHost.js";
const {
    FakeProcedureCorpusIndex,
}: typeof import("../../service/dist/test/fakeProcedureCorpusIndex.js") =
    await import(
        new URL(
            "../../../service/dist/test/fakeProcedureCorpusIndex.js",
            import.meta.url,
        ).href
    );
const {
    wikiTestAnswer,
}: typeof import("../../service/dist/test/wikiTestModel.js") = await import(
    new URL("../../../service/dist/test/wikiTestModel.js", import.meta.url).href
);
const {
    hydrateInventory,
    parseInventoryAudit,
}: typeof import("../../service/dist/viewInventory.js") = await import(
    new URL("../../../service/dist/viewInventory.js", import.meta.url).href
);
const {
    hydrateInventoryConstruction,
}: typeof import("../../service/dist/viewInventoryCoverage.js") = await import(
    new URL("../../../service/dist/viewInventoryCoverage.js", import.meta.url)
        .href
);
const {
    labelViewInput,
    retainedPassages,
}: typeof import("../../service/dist/viewSynthesisEvidence.js") = await import(
    new URL("../../../service/dist/viewSynthesisEvidence.js", import.meta.url)
        .href
);

test("authenticated MCP preserves dynamic definitions, manifests, no-op plans and durable receipts", async () => {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "memory-maintenance-wire-"),
    );
    const service = new FileMemoryService(root, {
        viewDrafts: true,
        indexFactory: (_id, directory) =>
            new FakeProcedureCorpusIndex(directory),
        viewSynthesisAdapter: {
            identity: "controlled-maintenance-wire",
            inventory: async (input) =>
                hydrateInventory(
                    input,
                    wikiTestAnswer(
                        "memory_source_fact_inventory",
                        labelViewInput(input, retainedPassages(input)),
                    ),
                ),
            checkInventory: async (_input, inventory) =>
                parseInventoryAudit(
                    wikiTestAnswer("memory_source_inventory_check", {
                        inventory,
                    }),
                ),
            generate: async (input, _signal, inventory) => {
                if (!inventory) throw new Error("Checked inventory required");
                return hydrateInventoryConstruction(
                    input,
                    inventory,
                    wikiTestAnswer("memory_wiki_construction", {
                        input,
                        inventory,
                    }),
                );
            },
            validate: async (_input, output) => ({
                supported: true,
                missingContext: [],
                reasons: [],
                exclusions: [],
                sections: output.content.sections.map((page) => ({
                    sectionId: page.id,
                    supported: true,
                    reason: "Controlled assessment",
                })),
                relationships: output.relationships.map((edge) => ({
                    edgeId: edge.id,
                    supported: true,
                    reason: "Controlled assessment",
                })),
            }),
        },
    });
    const host = await MemoryServiceHost.start(service);
    const client = await McpMemoryServiceClient.create({
        kind: "http",
        url: host.endpoint,
        headers: { authorization: `Bearer ${host.bearerToken}` },
    });
    async function wait(admitted: ViewBuildJob): Promise<ViewBuildJob> {
        let job = admitted;
        while (job.state === "running") {
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
            job = (await client.getViewBuild({
                corpusId: job.corpusId,
                jobId: job.jobId,
            }))!;
        }
        return job;
    }
    try {
        expect((await client.getCapabilities()).derivedViews?.maintenance).toBe(
            true,
        );
        const corpusId = (await client.createCorpus("Wire wiki")).corpusId;
        const source = await client.ingestDocument({
            corpusId,
            source: {
                sourceId: "s",
                sourceType: "text",
                title: "Payments",
                text: "Payments approval is unresolved.",
                metadata: {
                    viewSubjects: [
                        {
                            key: "payments",
                            title: "Payments",
                            taxonomy: "system",
                        },
                    ],
                },
            },
        });
        await client.waitForJob(source.jobId);
        const initial = await client.listViews(corpusId);
        const maintenance = {
            schemaVersion: 1 as const,
            scope: { mode: "currentSources" as const, sourceIds: ["s"] },
            wikiDiscovery: {
                rules: "explicit-subjects-v1" as const,
                createDraftPages: true,
                subjects: [],
            },
        };
        const job = await client.buildViews({
            corpusId,
            expectedHead: initial.head,
            publication: false,
            targets: [
                {
                    expectedVersion: 0,
                    definition: {
                        viewId: "wiki",
                        kind: "wiki",
                        selector: {
                            kind: "sources",
                            sources: [
                                {
                                    sourceId: "s",
                                    revisionId: source.revisionId,
                                },
                            ],
                        },
                        maintenance,
                    },
                },
            ],
        });
        const completed = await wait(job);
        if (completed.results[0].state !== "draft")
            throw new Error(completed.results[0].reason);
        const snapshot = await client.listViews(corpusId);
        expect(snapshot.views[0].definition.maintenance).toEqual(maintenance);
        expect(snapshot.views[0].maintenance?.registry[0].key).toBe("payments");
        expect(
            snapshot.views[0].maintenance?.pages[0].context[0].sourceId,
        ).toBe("s");
        const plan = await client.planViewMaintenance({
            corpusId,
            viewIds: ["wiki"],
        });
        expect(plan.targets[0].state).toBe("unchanged");
        const receipt = await client.maintainViews({
            corpusId,
            expectedHead: plan.expectedHead,
            targets: plan.targets.map(({ viewId, expectedVersion }) => ({
                viewId,
                expectedVersion,
            })),
        });
        expect(receipt.job).toBeUndefined();
        expect(
            (
                await client.getViewMaintenance({
                    corpusId,
                    receiptId: receipt.receiptId,
                })
            )?.plan.targets[0].snapshot?.privacySources,
        ).toEqual(["s"]);
        const latest = await client.listViews(corpusId);
        const pinned = await client.updateViewMaintenance({
            corpusId,
            viewId: "wiki",
            expectedHead: latest.head,
            expectedVersion: latest.views[0].version,
            maintenance: { schemaVersion: 1, scope: { mode: "pinned" } },
        });
        expect(pinned.version.definition.maintenance?.scope.mode).toBe(
            "pinned",
        );
    } finally {
        await client.close();
        await host.close();
        await rm(root, { recursive: true, force: true });
    }
});
