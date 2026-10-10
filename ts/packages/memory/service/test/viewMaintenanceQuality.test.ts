// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfigSync } from "@typeagent/config";
import { initRuntimeConfigFromProcessEnv } from "@typeagent/aiclient";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { createConfiguredViewSynthesisAdapter } from "../src/viewSynthesis.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import { viewContentToText } from "../src/viewText.js";
import { FakeProcedureCorpusIndex } from "./fakeProcedureCorpusIndex.js";
import type { ViewBuildJob, ViewSynthesisAdapter } from "../src/viewTypes.js";

test("configured model maintains explicit subjects, source facts and stable identity on a synthetic two-checkpoint corpus", async () => {
    loadConfigSync();
    initRuntimeConfigFromProcessEnv();
    const configured = createConfiguredViewSynthesisAdapter(
        process.env.TYPEAGENT_RUNBOOK_MODEL_ENDPOINT,
    );
    let stages = 0;
    const adapter: ViewSynthesisAdapter = {
        identity: configured.identity,
        inventory: async (input, signal) => {
            stages++;
            if (!configured.inventory)
                throw new Error("Configured inventory stage is unavailable");
            return configured.inventory(input, signal);
        },
        checkInventory: async (input, inventory, signal) => {
            stages++;
            if (!configured.checkInventory)
                throw new Error(
                    "Configured independent inventory check is unavailable",
                );
            return configured.checkInventory(input, inventory, signal);
        },
        generate: async (input, signal, inventory) => {
            stages++;
            return configured.generate(input, signal, inventory);
        },
        validate: async (input, output, signal) => {
            stages++;
            return configured.validate(input, output, signal);
        },
    };
    const root = await mkdtemp(
        path.join(os.tmpdir(), "memory-maintenance-live-"),
    );
    const service = new FileMemoryService(root, {
        viewDrafts: true,
        viewSynthesisAdapter: adapter,
        indexFactory: (_id, directory) =>
            new FakeProcedureCorpusIndex(directory),
    });
    async function wait(admitted: ViewBuildJob): Promise<ViewBuildJob> {
        for (;;) {
            const job = await service.getViewBuild({
                corpusId: admitted.corpusId,
                jobId: admitted.jobId,
            });
            if (!job)
                throw new Error("Configured-model build receipt disappeared");
            if (job.state !== "running") return job;
            await new Promise<void>((resolve) => setTimeout(resolve, 100));
        }
    }
    const payments = {
        key: "payments",
        title: "Payments system",
        taxonomy: "system" as const,
    };
    try {
        const corpusId = (
            await service.createCorpus("Synthetic maintained checkout")
        ).corpusId;
        const initial = await service.ingestDocument({
            corpusId,
            source: {
                sourceId: "charter",
                sourceType: "text",
                title: "Synthetic payments charter",
                text: "Payments processes checkout requests. The baseline checkout p95 was 420 milliseconds. The system owner is unknown. No recovery has been verified. New changes require fresh owner approval.",
                metadata: { project: "checkout", viewSubjects: [payments] },
            },
        });
        expect((await waitForMemoryJob(service, initial.jobId)).state).toBe(
            "complete",
        );
        await service.updateViewPublicationPolicy({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            expectedRevision: 0,
            autoPublish: false,
        });
        const job = await service.buildViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
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
                                    sourceId: initial.sourceId,
                                    revisionId: initial.revisionId,
                                },
                            ],
                        },
                        maintenance: {
                            schemaVersion: 1,
                            scope: {
                                mode: "scopedSources",
                                project: "checkout",
                            },
                            wikiDiscovery: {
                                rules: "explicit-subjects-v1",
                                createDraftPages: true,
                                subjects: [],
                            },
                        },
                    },
                },
            ],
        });
        const initialResult = (await wait(job)).results[0];
        if (initialResult.state !== "draft")
            throw new Error(
                `Initial configured-model construction: ${initialResult.reason}`,
            );
        const first = await service.getView({ corpusId, viewId: "wiki" });
        const pageId = first?.maintenance?.registry.find(
            (subject) => subject.key === payments.key,
        )?.pageId;
        expect(pageId).toBeDefined();
        const added = await service.ingestDocument({
            corpusId,
            source: {
                sourceId: "session",
                sourceType: "text",
                title: "Synthetic later session",
                text: "Checkout p95 rose to 2800 milliseconds. A reporting-query hypothesis was rejected after zero correlated traces. A pool-pressure hypothesis remains unresolved, not confirmed. The owner is still unknown. Approval and a verified recovery are still missing.",
                metadata: {
                    project: "checkout",
                    viewSubjects: [
                        payments,
                        {
                            key: "pool",
                            title: "Pool pressure",
                            taxonomy: "concept",
                        },
                    ],
                },
            },
        });
        expect((await waitForMemoryJob(service, added.jobId)).state).toBe(
            "complete",
        );
        const plan = await service.planViewMaintenance({
            corpusId,
            viewIds: ["wiki"],
        });
        const receipt = await service.maintainViews({
            corpusId,
            expectedHead: plan.expectedHead,
            targets: plan.targets.map(({ viewId, expectedVersion }) => ({
                viewId,
                expectedVersion,
            })),
        });
        expect(receipt.job).toBeDefined();
        const maintenanceResult = (await wait(receipt.job!)).results[0];
        if (maintenanceResult.state !== "draft")
            throw new Error(
                `Configured-model maintenance: ${maintenanceResult.reason}`,
            );
        const maintained = await service.getView({ corpusId, viewId: "wiki" });
        if (!maintained || maintained.content.kind !== "wiki")
            throw new Error("Missing qualified wiki");
        expect(maintained.content.sections).toHaveLength(2);
        expect(
            maintained.maintenance?.registry.find(
                (subject) => subject.key === payments.key,
            )?.pageId,
        ).toBe(pageId);
        const rendered = viewContentToText(maintained.content);
        expect(rendered).toMatch(/420/);
        expect(rendered).toMatch(/2800/);
        expect(rendered).toMatch(/rejected/i);
        expect(rendered).toMatch(/unresolved|unknown|unconfirmed/i);
        expect(maintained.generation?.inventoryAudit?.missingFacts).toEqual([]);
        const count = stages;
        const noOp = await service.planViewMaintenance({
            corpusId,
            viewIds: ["wiki"],
        });
        const unchanged = await service.maintainViews({
            corpusId,
            expectedHead: noOp.expectedHead,
            targets: noOp.targets.map(({ viewId, expectedVersion }) => ({
                viewId,
                expectedVersion,
            })),
        });
        expect(unchanged.job).toBeUndefined();
        expect(stages).toBe(count);
    } finally {
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
}, 720_000);
