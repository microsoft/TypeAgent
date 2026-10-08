// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { StructuredOutputJsonSchema } from "@typeagent/aiclient";
import type { ViewBuildJob, ViewSynthesisOutput } from "../src/viewTypes.js";
import { FakeProcedureCorpusIndex } from "./fakeProcedureCorpusIndex.js";
import { inventoryTestAnswer } from "./viewInventoryTestModel.js";
import { evidenceArray, evidenceRecord } from "../src/viewSynthesisEvidence.js";
import { authoredRelationships } from "../src/viewRelationships.js";
import { inventoryEvidence } from "../src/viewInventoryCoverage.js";

// Jest 29 exposes this ESM API, but @types/jest does not declare it.
const runtimeJest = import.meta.jest;
const jest = runtimeJest as typeof runtimeJest & {
    unstable_mockModule(
        name: string,
        factory: () => Record<string, unknown>,
    ): void;
};
const actual = await import("@typeagent/aiclient");
let alter: (name: string, response: unknown) => unknown = (_name, value) =>
    value;
let pausedStage: string | undefined;
let pause: Promise<void> | undefined;
const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
const complete = jest.fn(
    async (
        messages: Array<{ role: string; content: string }>,
        _usage: unknown,
        schema: StructuredOutputJsonSchema,
    ) => {
        const message = messages.find((entry) => entry.role === "user");
        if (!message) throw new Error("Missing configured-adapter input");
        const input = evidenceRecord(JSON.parse(message.content));
        calls.push({ name: schema.name, input });
        if (schema.name === pausedStage) await pause;
        return {
            success: true,
            data: JSON.stringify(
                alter(schema.name, inventoryTestAnswer(schema.name, input)),
            ),
        };
    },
);
jest.unstable_mockModule("@typeagent/aiclient", () => ({
    ...actual,
    openai: { ...actual.openai, createChatModel: () => ({ complete }) },
}));
const { FileMemoryService } = await import("../src/fileMemoryService.js");
const { waitForMemoryJob } = await import("../src/rpcFacade.js");
const { validateConstructedGuide } = await import("../src/viewSynthesis.js");
const { renderInventoryItem } = await import("../src/viewInventory.js");

describe("actual configured evidence-first adapter and durable service", () => {
    let root: string;
    let service: InstanceType<typeof FileMemoryService>;
    let corpusId: string;
    const open = () =>
        new FileMemoryService(root, {
            viewDrafts: true,
            indexFactory: (_id: string, directory: string) =>
                new FakeProcedureCorpusIndex(directory),
        });
    beforeEach(async () => {
        calls.length = 0;
        alter = (_name, value) => value;
        pausedStage = undefined;
        pause = undefined;
        root = await mkdtemp(
            path.join(os.tmpdir(), "inventory-configured-offline-"),
        );
        service = open();
        corpusId = (await service.createCorpus("Controlled inventory fixture"))
            .corpusId;
        for (const [sourceId, text] of [
            [
                "phase",
                "Acquisition 37 milliseconds versus SQL execution 4 milliseconds.\n\nQuery hypothesis rejected.\n\nScale deferred, not attempted.",
            ],
            [
                "limits",
                "Approval applies to this simulated incident only; no future execution authority.\n\nCapacity blocked pending owner review; measured headroom is required.\n\nRecovery is unknown.",
            ],
        ]) {
            const admitted = await service.ingestDocument({
                corpusId,
                source: {
                    sourceId,
                    sourceType: "text",
                    title: sourceId,
                    text,
                    capturedAt: "2026-10-02T10:00:00Z",
                    sourceModifiedAt: "2026-10-01T10:00:00Z",
                },
            });
            expect(
                (await waitForMemoryJob(service, admitted.jobId)).state,
            ).toBe("complete");
        }
    });
    afterEach(async () => {
        await service.close();
        await rm(root, { recursive: true, force: true });
    });
    async function admit(): Promise<ViewBuildJob> {
        const sources = await service.listSources(corpusId);
        const current = await service.listViews(corpusId);
        return service.buildViews({
            corpusId,
            expectedHead: current.head,
            targets: [
                {
                    expectedVersion: current.views[0]?.version ?? 0,
                    definition: {
                        viewId: "guide",
                        kind: "troubleshootingGuide",
                        selector: {
                            kind: "sources",
                            sources: sources.map((source) => ({
                                sourceId: source.sourceId,
                                revisionId: source.activeRevisionId!,
                            })),
                        },
                    },
                },
            ],
        });
    }
    async function wait(job: ViewBuildJob): Promise<ViewBuildJob> {
        for (let tries = 0; tries < 1000; tries++) {
            if (job.state !== "running") return job;
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
            const current = await service.getViewBuild({
                corpusId,
                jobId: job.jobId,
            });
            if (!current)
                throw new Error("Expected durable inventory build receipt");
            job = current;
        }
        throw new Error("Inventory build did not terminate");
    }
    async function build(): Promise<ViewBuildJob> {
        return wait(await admit());
    }
    async function awaitPausedStage(): Promise<void> {
        for (let tries = 0; tries < 1000; tries++) {
            if (calls.some((call) => call.name === pausedStage)) return;
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("Configured adapter did not reach paused stage");
    }
    test("source inventory and independent source check precede any candidate; coverage survives receipt/protocol shape", async () => {
        const job = await build();
        expect(job.state).toBe("complete");
        expect(calls.map((call) => call.name)).toEqual([
            "memory_source_fact_inventory",
            "memory_source_inventory_check",
            "memory_inventory_guide_construction",
            "memory_inventory_artifact_support",
            "memory_inventory_artifact_support",
        ]);
        expect(calls[0].input).not.toHaveProperty("output");
        expect(calls[0].input).not.toHaveProperty("inventory");
        expect(calls[1].input).not.toHaveProperty("output");
        expect(JSON.stringify(calls.slice(0, 2))).not.toContain(
            "Controlled conditional guide",
        );
        const result = job.results[0];
        expect(result.inventory!.items).toHaveLength(6);
        expect(result.inventoryAudit!.supported).toBe(true);
        expect(result.coverage!.reuseEligibility).toBe("diagnosticOnly");
        expect(
            result.coverage!.items.every((item) => item.state === "covered"),
        ).toBe(true);
        const view = (await service.listViews(corpusId)).views[0];
        for (const item of result.inventory!.items)
            expect(
                view.content.sections.some((section) =>
                    section.body.includes(renderInventoryItem(item)),
                ),
            ).toBe(true);
        for (const edge of view.relationships) {
            if (edge.origin === "system" || edge.to.kind !== "source") continue;
            const target = edge.to;
            expect(
                edge.citations.every(
                    (citation) =>
                        citation.sourceId === target.sourceId &&
                        citation.revisionId === target.revisionId,
                ),
            ).toBe(true);
        }
        expect(view.generation!.inventory!.fingerprint).toBe(
            result.inventory!.fingerprint,
        );
    });
    test("typed quantity/unit/comparison, decision state and distinct timing render in actual body", async () => {
        alter = (name, value) => {
            if (name !== "memory_source_fact_inventory") return value;
            for (const item of evidenceArray(evidenceRecord(value).items).map(
                evidenceRecord,
            )) {
                if (String(item.statement).startsWith("Acquisition")) {
                    item.kind = "measurement";
                    item.status = "observed";
                    item.measurements = [
                        {
                            quantity: "37",
                            unit: "milliseconds",
                            context:
                                "connection acquisition compared with 4 milliseconds SQL execution",
                        },
                    ];
                    item.occurredAt = "2026-10-01T10:00:00Z";
                    item.learnedAt = "2026-10-02T10:00:00Z";
                } else if (String(item.statement).startsWith("Query")) {
                    item.kind = "approach";
                    item.status = "rejected";
                } else if (String(item.statement).startsWith("Scale")) {
                    item.kind = "approach";
                    item.status = "deferred";
                } else if (String(item.statement).startsWith("Capacity")) {
                    item.kind = "unresolved";
                    item.status = "blocked";
                } else if (String(item.statement).startsWith("Approval")) {
                    item.kind = "authority";
                    item.status = "observed";
                }
            }
            return value;
        };
        expect((await build()).state).toBe("complete");
        const body = (
            await service.listViews(corpusId)
        ).views[0].content.sections
            .map((section) => section.body)
            .join("\n");
        for (const literal of [
            "37 milliseconds",
            "4 milliseconds",
            "status: rejected",
            "status: deferred",
            "status: blocked",
            "no future execution authority",
            "Occurred: 2026-10-01",
            "Known/recorded: 2026-10-02",
        ])
            expect(body).toContain(literal);
    });
    test("a plausible incomplete draft fails coverage before a rubber-stamped support audit", async () => {
        alter = (name, value) => {
            if (name === "memory_inventory_guide_construction") {
                for (const section of evidenceArray(
                    evidenceRecord(evidenceRecord(value).content).sections,
                ).map(evidenceRecord))
                    section.inventoryIds = evidenceArray(
                        section.inventoryIds,
                    ).slice(0, 1);
            }
            return value;
        };
        const job = await build();
        expect(job.state).toBe("failed");
        expect(job.results[0].reason).toContain(
            "Required inventory content is absent",
        );
        expect(
            calls.some(
                (call) => call.name === "memory_inventory_artifact_support",
            ),
        ).toBe(false);
        expect((await service.listViews(corpusId)).views).toHaveLength(0);
        expect(job.results[0].inventory).toBeDefined();
    });
    test("missing source-to-inventory facts block construction and persist independent assessment", async () => {
        alter = (name, value) => {
            if (name === "memory_source_inventory_check") {
                const raw = evidenceRecord(value);
                raw.supported = false;
                raw.reasons = ["Workload headroom warning omitted"];
            }
            return value;
        };
        const job = await build();
        expect(job.results[0].state).toBe("blocked");
        expect(job.results[0].inventoryAudit!.supported).toBe(false);
        expect(calls.map((call) => call.name)).toHaveLength(2);
    });
    test("unresolved early inventory cannot authorize verified/reusable recovery", async () => {
        alter = (name, value) => {
            if (name === "memory_inventory_guide_construction")
                evidenceRecord(value).outcome = "verifiedRecovery";
            return value;
        };
        const job = await build();
        expect(job.results[0].state).toBe("blocked");
        expect(job.results[0].reason).toContain(
            "diagnosticOnly cannot become reusable",
        );
    });
    test("complete final body, not coverage metadata, gates human saves and preserves legitimate narrative edits", async () => {
        await build();
        const snapshot = await service.listViews(corpusId);
        const view = snapshot.views[0];
        const content = structuredClone(
            view.content,
        ) as ViewSynthesisOutput["content"];
        content.sections[0].body = content.sections[0].body.replace(
            "Inspect pressure.",
            "Inspect pressure carefully.",
        );
        const relationships = authoredRelationships(view).filter(
            (edge) =>
                !(
                    edge.from.kind === "section" &&
                    edge.from.sectionId === "diagnostic" &&
                    edge.to.kind === "source" &&
                    edge.to.sourceId === "phase"
                ),
        );
        const originalSupport = relationships.find(
            (edge) =>
                edge.from.kind === "section" &&
                edge.from.sectionId === "description" &&
                edge.to.kind === "source" &&
                edge.to.sourceId === "phase",
        )!;
        await service.saveViewDraft({
            corpusId,
            viewId: view.viewId,
            expectedVersion: view.version,
            expectedHead: snapshot.head,
            definition: {
                viewId: view.viewId,
                kind: "troubleshootingGuide",
                selector: view.definition.selector,
            },
            content,
            relationships,
        });
        const replacement = await service.ingestDocument({
            corpusId,
            source: {
                sourceId: "phase",
                sourceType: "text",
                title: "phase",
                text: "Acquisition 38 milliseconds versus SQL execution 4 milliseconds.\n\nQuery hypothesis rejected.\n\nScale deferred, not attempted.",
                capturedAt: "2026-10-03T10:00:00Z",
            },
        });
        expect((await waitForMemoryJob(service, replacement.jobId)).state).toBe(
            "complete",
        );
        expect((await build()).state).toBe("complete");
        expect((await build()).state).toBe("complete");
        const current = await service.listViews(corpusId);
        expect(current.views[0].content.sections[0].body).toContain(
            "carefully",
        );
        expect(current.views[0].content.sections[0].body).toContain(
            "Acquisition 38 milliseconds",
        );
        const refreshedSupport = authoredRelationships(current.views[0]).find(
            (edge) =>
                edge.from.kind === "section" &&
                edge.from.sectionId === "description" &&
                edge.to.kind === "source" &&
                edge.to.sourceId === "phase",
        )!;
        expect(refreshedSupport.id).not.toBe(originalSupport.id);
        expect(refreshedSupport.to).toEqual({
            kind: "source",
            sourceId: "phase",
            revisionId: replacement.revisionId,
        });
        expect(
            current.views[0].relationships.some(
                (edge) =>
                    edge.origin !== "system" &&
                    edge.from.kind === "section" &&
                    edge.from.sectionId === "diagnostic" &&
                    edge.to.kind === "source" &&
                    edge.to.sourceId === "phase",
            ),
        ).toBe(false);
        expect(
            current.views[0].edits!.some(
                (edit) =>
                    edit.operation === "delete" &&
                    edit.status === "merged" &&
                    edit.actor === os.userInfo().username,
            ),
        ).toBe(true);
        const incomplete = structuredClone(
            current.views[0].content,
        ) as ViewSynthesisOutput["content"];
        const fact = current.views[0].generation!.inventory!.items[0];
        for (const section of incomplete.sections)
            section.body = section.body.replace(
                renderInventoryItem(fact),
                "A generic investigation is necessary.",
            );
        await expect(
            service.saveViewDraft({
                corpusId,
                viewId: view.viewId,
                expectedVersion: current.views[0].version,
                expectedHead: current.head,
                definition: {
                    viewId: view.viewId,
                    kind: "troubleshootingGuide",
                    selector: current.views[0].definition.selector,
                },
                content: incomplete,
                relationships: authoredRelationships(current.views[0]),
            }),
        ).rejects.toThrow("Required inventory content is absent");
        expect((await service.listViews(corpusId)).head).toBe(current.head);
    });
    test("unknown source grounding and blanket required-fact exclusions cannot be repaired", async () => {
        alter = (name, value) => {
            if (name === "memory_source_fact_inventory")
                evidenceRecord(
                    evidenceArray(evidenceRecord(value).items)[0],
                ).passageIds = ["not-retained"];
            return value;
        };
        expect((await build()).results[0].reason).toContain(
            "Unknown retained passage",
        );
        alter = (name, value) => {
            if (name === "memory_inventory_guide_construction") {
                const raw = evidenceRecord(value);
                const itemId = evidenceArray(
                    evidenceRecord(raw.content).sections,
                ).map(evidenceRecord)[0].inventoryIds;
                raw.exclusions = [
                    {
                        itemId: evidenceArray(itemId)[0],
                        reason: "outsideScope",
                        duplicateOf: "",
                        justification: "irrelevant",
                    },
                ];
            }
            return value;
        };
        expect((await build()).results[0].reason).toContain(
            "Only independently classified background",
        );
    });
    test("forget removes inventory, coverage, candidate and durable history payload eligibility", async () => {
        const job = await build();
        const preview = await service.previewForgetSource(corpusId, "phase");
        await service.forgetSource({
            corpusId,
            sourceId: "phase",
            confirmationToken: preview.confirmationToken,
        });
        expect(
            await service.getViewBuild({ corpusId, jobId: job.jobId }),
        ).toBeUndefined();
        expect((await service.listViews(corpusId)).views).toHaveLength(0);
        expect(
            await service.getViewHistory({ corpusId, viewId: "guide" }),
        ).toHaveLength(0);
    });
    test("forged coverage cannot stand in for actual inventory content", async () => {
        await build();
        const view = (await service.listViews(corpusId)).views[0];
        const output: ViewSynthesisOutput = {
            content: structuredClone(
                view.content,
            ) as ViewSynthesisOutput["content"],
            relationships: authoredRelationships(view),
            outcome: "diagnosticOnly",
            missingEvidence: ["unknown"],
            ...inventoryEvidence(view.generation!),
        };
        for (const section of output.content.sections)
            section.body = "Generic plausible prose.";
        expect(() =>
            validateConstructedGuide(view.generation!.input!, output),
        ).toThrow("Required inventory content is absent");
    });
    test.each(["metadata", "wrongWitness"])(
        "source ledger rejects %s escape before checking or constructing prose",
        async (mode) => {
            alter = (name, value) => {
                if (name !== "memory_source_fact_inventory") return value;
                const raw = evidenceRecord(value);
                const decision = evidenceRecord(
                    evidenceArray(raw.sourceDecisions)[0],
                );
                if (mode === "metadata") {
                    decision.disposition = "metadata";
                    decision.itemKeys = [];
                } else
                    decision.itemKeys = [
                        evidenceRecord(evidenceArray(raw.items)[3]).key,
                    ];
                return value;
            };
            const job = await build();
            expect(job.results[0].reason).toContain(
                mode === "metadata"
                    ? "Metadata exclusions"
                    : "Source decision witnesses",
            );
            expect(calls.map((call) => call.name)).toEqual([
                "memory_source_fact_inventory",
            ]);
        },
    );
    test.each([
        "memory_source_fact_inventory",
        "memory_source_inventory_check",
    ])(
        "forget during %s prevents late inventory/prose persistence and survives reopening",
        async (stage) => {
            pausedStage = stage;
            let release!: () => void;
            pause = new Promise<void>((resolve) => {
                release = resolve;
            });
            try {
                const job = await admit();
                await awaitPausedStage();
                const preview = await service.previewForgetSource(
                    corpusId,
                    "phase",
                );
                await service.forgetSource({
                    corpusId,
                    sourceId: "phase",
                    confirmationToken: preview.confirmationToken,
                });
                release();
                await service.close();
                service = open();
                expect(
                    await service.getViewBuild({ corpusId, jobId: job.jobId }),
                ).toBeUndefined();
                expect((await service.listViews(corpusId)).views).toHaveLength(
                    0,
                );
                expect(
                    await service.getViewHistory({ corpusId, viewId: "guide" }),
                ).toHaveLength(0);
                expect(
                    calls.some(
                        (call) =>
                            call.name === "memory_inventory_guide_construction",
                    ),
                ).toBe(false);
            } finally {
                release();
            }
        },
    );
    test("source replacement during independent inventory checking cannot materialize obsolete evidence", async () => {
        pausedStage = "memory_source_inventory_check";
        let release!: () => void;
        pause = new Promise<void>((resolve) => {
            release = resolve;
        });
        try {
            const job = await admit();
            await awaitPausedStage();
            const replacement = await service.ingestDocument({
                corpusId,
                source: {
                    sourceId: "phase",
                    sourceType: "text",
                    title: "phase",
                    text: "New workload warning: old acquisition observations cannot qualify capacity.",
                    capturedAt: "2026-10-03T10:00:00Z",
                },
            });
            await waitForMemoryJob(service, replacement.jobId);
            release();
            const completed = await wait(job);
            expect(completed.results[0].state).toBe("stale");
            expect(completed.results[0].inventory).toBeDefined();
            expect((await service.listViews(corpusId)).views).toHaveLength(0);
        } finally {
            release();
        }
    });
    test("conflict resolution inherits checked inventory, rejects forged omissions and retains authenticated edits after rebuilding", async () => {
        await build();
        const first = await service.listViews(corpusId);
        const human = structuredClone(
            first.views[0].content,
        ) as ViewSynthesisOutput["content"];
        human.sections[0].body = human.sections[0].body.replace(
            "Inspect pressure.",
            "Inspect pressure carefully.",
        );
        const saved = await service.saveViewDraft({
            corpusId,
            viewId: "guide",
            expectedHead: first.head,
            expectedVersion: first.views[0].version,
            definition: {
                viewId: "guide",
                kind: "troubleshootingGuide",
                selector: first.views[0].definition.selector,
            },
            content: human,
            relationships: authoredRelationships(first.views[0]),
        });
        alter = (name, value) => {
            if (name === "memory_inventory_guide_construction") {
                const section = evidenceRecord(
                    evidenceArray(
                        evidenceRecord(evidenceRecord(value).content).sections,
                    )[0],
                );
                section.prose =
                    "Inspect pressure conservatively.\n\nPreserve approval boundaries.\n";
            }
            return value;
        };
        const job = await build();
        expect(job.results[0].state).toBe("conflicted");
        const conflict = (await service.getViewConflict({
            corpusId,
            conflictId: job.results[0].conflictId!,
        }))!;
        expect(conflict.candidate.inventoryAudit!.supported).toBe(true);
        expect((await build()).results[0].conflictId).toBe(conflict.conflictId);
        const current = await service.listViews(corpusId);
        const request = {
            corpusId,
            conflictId: conflict.conflictId,
            expectedHead: current.head!,
            expectedVersion: saved.version.version,
            expectedRevisionId: saved.version.revisionId,
            inputFingerprint: conflict.input.fingerprint,
        };
        const forged = structuredClone(conflict.candidate);
        for (const section of forged.content.sections)
            section.body = "Plausible but incomplete.";
        forged.inventory!.items = [];
        await expect(
            service.resolveViewConflict({
                ...request,
                choice: "combined",
                combined: forged,
            }),
        ).rejects.toThrow("Required inventory content is absent");
        expect((await service.listViews(corpusId)).head).toBe(current.head);
        const resolved = await service.resolveViewConflict({
            ...request,
            choice: "human",
        });
        expect(resolved.version.actor).toBe(os.userInfo().username);
        expect((await build()).state).toBe("complete");
        expect(
            (await service.listViews(corpusId)).views[0].content.sections[0]
                .body,
        ).toContain("carefully");
    });
});
