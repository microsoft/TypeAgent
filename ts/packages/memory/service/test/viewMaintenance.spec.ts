// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { StructuredOutputJsonSchema } from "@typeagent/aiclient";
import type {
    ViewBuildJob,
    ViewMaintenanceDefinition,
    WikiSubject,
} from "../src/viewTypes.js";
import { FakeProcedureCorpusIndex } from "./fakeProcedureCorpusIndex.js";
import { wikiTestAnswer } from "./wikiTestModel.js";
import { authoredRelationships } from "../src/viewRelationships.js";
import { wikiIndex } from "../src/viewContent.js";
import {
    resolveViewMaintenance,
    validateMaintenanceDefinition,
} from "../src/viewMaintenance.js";

const jestRuntime = import.meta.jest;
const jest = jestRuntime as typeof jestRuntime & {
    unstable_mockModule(
        name: string,
        factory: () => Record<string, unknown>,
    ): void;
};
const actual = await import("@typeagent/aiclient");
let calls = 0;
let beforeConstruction: (() => Promise<void>) | undefined;
let invalidIdentity = false;
let invalidView: string | undefined;
jest.unstable_mockModule("@typeagent/aiclient", () => ({
    ...actual,
    tryCreateEmbeddingModel: () => undefined,
    openai: {
        ...actual.openai,
        createChatModel: () => ({
            complete: async (
                messages: Array<{ role: string; content: string }>,
                _usage: unknown,
                schema: StructuredOutputJsonSchema,
            ) => {
                calls++;
                if (schema.name === "memory_wiki_construction")
                    await beforeConstruction?.();
                const message = messages.find(
                    (message) => message.role === "user",
                );
                if (!message)
                    throw new Error("Missing controlled source input");
                const input = JSON.parse(message.content);
                const output = wikiTestAnswer(schema.name, input);
                if (
                    invalidIdentity &&
                    schema.name === "memory_wiki_construction" &&
                    (!invalidView ||
                        input.input.definition.viewId === invalidView)
                ) {
                    const content = output as {
                        content: { pages: Array<{ id: string }> };
                    };
                    content.content.pages[0].id = "unreviewed-identity";
                }
                return { success: true, data: JSON.stringify(output) };
            },
        }),
    },
}));
const { FileMemoryService } = await import("../src/fileMemoryService.js");
const { waitForMemoryJob } = await import("../src/rpcFacade.js");
const { runMemoryViewsCli } = await import("../src/memoryViewsCli.js");

const alpha: WikiSubject = {
    key: "payments",
    title: "Payments",
    taxonomy: "system",
};
const beta: WikiSubject = {
    key: "pool",
    title: "Pool pressure",
    taxonomy: "concept",
};
const policy: ViewMaintenanceDefinition = {
    schemaVersion: 1,
    scope: { mode: "scopedSources", tags: ["operations"] },
    wikiDiscovery: {
        rules: "explicit-subjects-v1",
        createDraftPages: true,
        subjects: [],
    },
};

describe("manual maintained wiki lifecycle through configured construction", () => {
    let root: string;
    let corpusId: string;
    let service: InstanceType<typeof FileMemoryService>;
    const open = () =>
        new FileMemoryService(root, {
            viewDrafts: true,
            indexFactory: (_id, directory) =>
                new FakeProcedureCorpusIndex(directory),
            procedureIndexFactory: (_id, directory) =>
                new FakeProcedureCorpusIndex(directory),
        });
    beforeEach(async () => {
        root = await mkdtemp(path.join(os.tmpdir(), "memory-maintenance-"));
        service = open();
        calls = 0;
        invalidIdentity = false;
        invalidView = undefined;
        beforeConstruction = undefined;
        corpusId = (await service.createCorpus("Maintained payments")).corpusId;
        await ingest("s", [alpha]);
        await service.updateViewPublicationPolicy({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            expectedRevision: 0,
            autoPublish: false,
        });
        const source = (await service.getSource(corpusId, "s"))!;
        const state = await service.listViews(corpusId);
        const job = await service.buildViews({
            corpusId,
            expectedHead: state.head,
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
                                    revisionId: source.activeRevisionId,
                                },
                            ],
                        },
                        maintenance: structuredClone(policy),
                    },
                },
            ],
        });
        expect((await wait(job)).results[0].state).toBe("draft");
    });
    afterEach(async () => {
        beforeConstruction = undefined;
        await service.close();
        await rm(root, { recursive: true, force: true });
    });
    async function ingest(
        sourceId: string,
        subjects: WikiSubject[],
        text = "Capacity remains BLOCKED pending owner review. Competing explanations are unresolved.",
        tags = ["operations"],
    ) {
        const job = await service.ingestDocument({
            corpusId,
            source: {
                sourceId,
                sourceType: "text",
                title: sourceId,
                text,
                tags,
                metadata: { viewSubjects: subjects },
            },
        });
        expect((await waitForMemoryJob(service, job.jobId)).state).toBe(
            "complete",
        );
    }
    async function wait(admitted: ViewBuildJob): Promise<ViewBuildJob> {
        for (let tries = 0; tries < 500; tries++) {
            const job = await service.getViewBuild({
                corpusId,
                jobId: admitted.jobId,
            });
            if (!job) throw new Error("Maintenance build disappeared");
            if (job.state !== "running") return job;
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("Maintenance build did not finish");
    }
    async function maintain() {
        const plan = await service.planViewMaintenance({
            corpusId,
            viewIds: ["wiki"],
        });
        return service.maintainViews({
            corpusId,
            expectedHead: plan.expectedHead,
            targets: plan.targets.map(({ viewId, expectedVersion }) => ({
                viewId,
                expectedVersion,
            })),
        });
    }
    async function current() {
        const view = await service.getView({ corpusId, viewId: "wiki" });
        if (!view || view.content.kind !== "wiki")
            throw new Error("Missing maintained wiki");
        return { view, content: view.content };
    }
    test("no-op and unrelated membership make zero model calls; checkpoints and receipts survive restart", async () => {
        const checkpoint = (await current()).view.maintenance;
        const count = calls;
        await ingest("unrelated", [beta], "Unrelated evidence.", ["other"]);
        const receipt = await maintain();
        expect(receipt.plan.targets[0].state).toBe("unchanged");
        expect(receipt.job).toBeUndefined();
        expect(calls).toBe(count);
        expect((await current()).view.maintenance).toEqual(checkpoint);
        await service.close();
        service = open();
        expect(
            (
                await service.getViewMaintenance({
                    corpusId,
                    receiptId: receipt.receiptId,
                })
            )?.plan.targets[0].state,
        ).toBe("unchanged");
        expect((await maintain()).job).toBeUndefined();
        expect(calls).toBe(count);
    });
    test("new evidence extends a stable subject and discovers new pages; revised old sources can discover pages too", async () => {
        const initial = await current();
        const pageId = initial.content.sections[0].id;
        await ingest(
            "new",
            [alpha, beta],
            "Pool pressure remains unresolved; payments capacity is blocked.",
        );
        expect((await current()).view.state).toBe("stale");
        const receipt = await maintain();
        expect(receipt.job).toBeDefined();
        expect((await wait(receipt.job!)).results[0].state).toBe("draft");
        const updated = await current();
        expect(updated.content.sections).toHaveLength(2);
        expect(
            updated.view.maintenance?.registry.find(
                (subject) => subject.key === alpha.key,
            )?.pageId,
        ).toBe(pageId);
        expect(updated.view.maintenance?.dependencies).toHaveLength(2);
        expect(
            updated.view.maintenance?.pages.every(
                (page) => page.context.length === 2,
            ),
        ).toBe(true);
        expect((await maintain()).job).toBeUndefined();
        await ingest(
            "s",
            [
                alpha,
                {
                    key: "checkout",
                    title: "Checkout project",
                    taxonomy: "project",
                },
            ],
            "Checkout is proposed; owner review remains pending.",
        );
        const revised = await maintain();
        expect((await wait(revised.job!)).results[0].state).toBe("draft");
        expect((await current()).content.sections).toHaveLength(3);
        expect(
            (
                await service.getViewMaintenance({
                    corpusId,
                    receiptId: revised.receiptId,
                })
            )?.job?.state,
        ).toBe("complete");
    });
    test("reviewed subject rename retains page identity without changing evidence or an index timestamp", async () => {
        const { view, content } = await current();
        const initialId = content.sections[0].id;
        await service.updateViewMaintenance({
            corpusId,
            viewId: "wiki",
            expectedHead: (await service.listViews(corpusId)).head,
            expectedVersion: view.version,
            maintenance: {
                ...policy,
                wikiDiscovery: {
                    ...policy.wikiDiscovery!,
                    subjects: [{ ...alpha, title: "Payments architecture" }],
                },
            },
        });
        const receipt = await maintain();
        expect((await wait(receipt.job!)).results[0].state).toBe("draft");
        expect((await current()).content.sections[0]).toMatchObject({
            id: initialId,
            heading: "Payments architecture",
        });
    });
    test("unresolved identity blocks acceptance and does not advance the successful checkpoint", async () => {
        const checkpoint = (await current()).view.maintenance;
        await ingest(
            "s",
            [alpha, beta],
            "Pool pressure is unresolved. Capacity remains blocked.",
        );
        invalidIdentity = true;
        const receipt = await maintain();
        expect((await wait(receipt.job!)).results[0].state).toBe("blocked");
        expect((await current()).view.maintenance).toEqual(checkpoint);
    });
    test("ambiguous explicit identity and unsupported removal surface blockers without synthesis", async () => {
        await ingest("collision", [{ ...alpha, title: "Different system" }]);
        const count = calls;
        const receipt = await maintain();
        expect(receipt.plan.targets[0]).toMatchObject({ state: "blocked" });
        expect(receipt.plan.targets[0].reason).toContain("Ambiguous");
        expect(receipt.job).toBeUndefined();
        expect(calls).toBe(count);
    });
    test("human omission persists as registry intent and cannot silently reappear", async () => {
        await ingest(
            "s",
            [alpha, beta],
            "Pool pressure is unresolved. Capacity is blocked.",
        );
        const receipt = await maintain();
        await wait(receipt.job!);
        const { view, content } = await current();
        const omitted = view.maintenance!.registry.find(
            (subject) => subject.key === beta.key,
        )!.pageId;
        const retained = {
            ...content,
            sections: content.sections.filter((page) => page.id !== omitted),
        };
        retained.index = wikiIndex(retained.sections);
        const head = (await service.listViews(corpusId)).head;
        const saved = await service.saveViewDraft({
            corpusId,
            viewId: "wiki",
            expectedHead: head,
            expectedVersion: view.version,
            definition: {
                viewId: "wiki",
                kind: "wiki",
                selector: view.definition.selector,
                maintenance: view.definition.maintenance!,
            },
            content: retained,
            relationships: authoredRelationships(view).filter(
                (edge) =>
                    edge.from.sectionId !== omitted &&
                    (edge.to.kind !== "section" ||
                        edge.to.sectionId !== omitted),
            ),
        });
        expect(
            saved.version.maintenance?.registry.find(
                (subject) => subject.key === beta.key,
            )?.state,
        ).toBe("omitted");
        expect((await maintain()).job).toBeUndefined();
        await ingest(
            "s",
            [alpha, beta],
            "Pool pressure is unresolved. Capacity is blocked. Owner approval is still missing.",
        );
        const rebuilt = await maintain();
        const outcome = (await wait(rebuilt.job!)).results[0];
        expect(["conflicted", "merged", "draft"]).toContain(outcome.state);
        expect(
            (await current()).content.sections.some(
                (page) => page.id === omitted,
            ),
        ).toBe(false);
    });
    test("new eligible evidence arriving during generation cannot accept an obsolete scope", async () => {
        await ingest(
            "s",
            [alpha],
            "Capacity remains blocked; fresh owner review is required.",
        );
        let release!: () => void;
        let started!: () => void;
        const entered = new Promise<void>((resolve) => {
            started = resolve;
        });
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        beforeConstruction = async () => {
            started();
            await gate;
        };
        const checkpoint = (await current()).view.maintenance;
        const receipt = await maintain();
        await entered;
        try {
            await ingest("late", [beta], "Pool pressure remains unresolved.");
        } finally {
            release();
        }
        expect((await wait(receipt.job!)).results[0].state).toBe("stale");
        expect((await current()).view.maintenance).toEqual(checkpoint);
    });
    test("saving human edits cannot clear evidence staleness or advance its checkpoint", async () => {
        const { view, content } = await current();
        await ingest(
            "new",
            [alpha],
            "Payments owner approval remains missing.",
        );
        const stale = (await current()).view;
        const saved = await service.saveViewDraft({
            corpusId,
            viewId: "wiki",
            expectedHead: (await service.listViews(corpusId)).head,
            expectedVersion: stale.version,
            definition: {
                viewId: "wiki",
                kind: "wiki",
                selector: view.definition.selector,
                maintenance: view.definition.maintenance!,
            },
            content,
            relationships: authoredRelationships(view),
        });
        expect(saved.version.state).toBe("stale");
        expect(saved.version.maintenance?.fingerprint).toBe(
            view.maintenance?.fingerprint,
        );
        expect(
            (await service.planViewMaintenance({ corpusId, viewIds: ["wiki"] }))
                .targets[0].state,
        ).toBe("rebuild");
    });
    test("a removed active subject blocks retirement instead of deleting its page", async () => {
        await ingest(
            "s",
            [alpha, beta],
            "Payments approval is unknown; pool pressure is unresolved.",
        );
        const receipt = await maintain();
        expect((await wait(receipt.job!)).results[0].state).toBe("draft");
        const checkpoint = (await current()).view.maintenance;
        await ingest("s", [alpha], "Payments approval is still unknown.");
        const count = calls;
        const removed = await maintain();
        expect(removed.plan.targets[0].state).toBe("blocked");
        expect(removed.plan.targets[0].reason).toContain("removal");
        expect(removed.job).toBeUndefined();
        expect(calls).toBe(count);
        expect((await current()).view.maintenance).toEqual(checkpoint);
    });
    test("forget purges artifacts, page registry, build and maintenance receipts", async () => {
        const receipt = await maintain();
        const preview = await service.previewForgetSource(corpusId, "s");
        await service.forgetSource({
            corpusId,
            sourceId: "s",
            confirmationToken: preview.confirmationToken,
        });
        expect(
            await service.getView({ corpusId, viewId: "wiki" }),
        ).toBeUndefined();
        expect(
            await service.getViewMaintenance({
                corpusId,
                receiptId: receipt.receiptId,
            }),
        ).toBeUndefined();
        expect(
            await service.getViewHistory({ corpusId, viewId: "wiki" }),
        ).toEqual([]);
        expect(await service.listViewBuilds(corpusId)).toEqual([]);
    });
    test("guarded configuration and stale maintenance requests cannot overwrite newer state", async () => {
        const plan = await service.planViewMaintenance({
            corpusId,
            viewIds: ["wiki"],
        });
        const view = (await current()).view;
        await service.updateViewMaintenance({
            corpusId,
            viewId: "wiki",
            expectedHead: plan.expectedHead,
            expectedVersion: view.version,
            maintenance: { schemaVersion: 1, scope: { mode: "pinned" } },
        });
        await expect(
            service.maintainViews({
                corpusId,
                expectedHead: plan.expectedHead,
                targets: [{ viewId: "wiki", expectedVersion: view.version }],
            }),
        ).rejects.toThrow("head or target version");
        expect((await maintain()).plan.targets[0].state).toBe("pinned");
    });
    test("changing maintenance intent cannot leave an older published definition searchable as current", async () => {
        const { view } = await current();
        await service.publishView({
            corpusId,
            viewId: "wiki",
            revisionId: view.revisionId,
            expectedVersion: view.version,
            expectedHead: (await service.listViews(corpusId)).head!,
        });
        expect(
            await service.searchViews({
                corpusId,
                query: "Capacity",
                freshness: "current",
                kinds: ["wiki"],
            }),
        ).toHaveLength(1);
        await service.updateViewMaintenance({
            corpusId,
            viewId: "wiki",
            expectedHead: (await service.listViews(corpusId)).head,
            expectedVersion: view.version,
            maintenance: {
                ...policy,
                scope: { mode: "scopedSources", tags: ["different-scope"] },
            },
        });
        expect(
            await service.searchViews({
                corpusId,
                query: "Capacity",
                freshness: "current",
                kinds: ["wiki"],
            }),
        ).toEqual([]);
    });
    test("partial batches checkpoint successful views individually and do not rebuild them on retry", async () => {
        const source = (await service.getSource(corpusId, "s"))!;
        const build = await service.buildViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            publication: false,
            targets: [
                {
                    expectedVersion: 0,
                    definition: {
                        viewId: "other-wiki",
                        kind: "wiki",
                        selector: {
                            kind: "sources",
                            sources: [
                                {
                                    sourceId: "s",
                                    revisionId: source.activeRevisionId,
                                },
                            ],
                        },
                        maintenance: policy,
                    },
                },
            ],
        });
        expect((await wait(build)).results[0].state).toBe("draft");
        const otherBefore = (await service.getView({
            corpusId,
            viewId: "other-wiki",
        }))!.maintenance;
        await ingest("new", [beta], "Pool pressure is unconfirmed.");
        invalidIdentity = true;
        invalidView = "other-wiki";
        const plan = await service.planViewMaintenance({
            corpusId,
            viewIds: ["wiki", "other-wiki"],
        });
        const receipt = await service.maintainViews({
            corpusId,
            expectedHead: plan.expectedHead,
            targets: plan.targets.map(({ viewId, expectedVersion }) => ({
                viewId,
                expectedVersion,
            })),
        });
        const completed = await wait(receipt.job!);
        expect(completed.state).toBe("partial");
        expect(completed.results.map((result) => result.state)).toEqual([
            "draft",
            "blocked",
        ]);
        expect(
            (await service.getView({ corpusId, viewId: "other-wiki" }))!
                .maintenance,
        ).toEqual(otherBefore);
        const retryPlan = await service.planViewMaintenance({
            corpusId,
            viewIds: ["wiki", "other-wiki"],
        });
        expect(retryPlan.targets.map((target) => target.state)).toEqual([
            "unchanged",
            "rebuild",
        ]);
    });
    test("cancellation and service restart do not advance the accepted evidence checkpoint", async () => {
        await ingest(
            "s",
            [alpha],
            "Payments approval remains missing; owner review is required.",
        );
        let release!: () => void;
        let started!: () => void;
        const entered = new Promise<void>((resolve) => {
            started = resolve;
        });
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        beforeConstruction = async () => {
            started();
            await gate;
        };
        const checkpoint = (await current()).view.maintenance;
        const receipt = await maintain();
        await entered;
        try {
            await service.cancelViewBuild({
                corpusId,
                jobId: receipt.job!.jobId,
            });
            expect((await wait(receipt.job!)).state).toBe("cancelled");
            await service.close();
        } finally {
            release();
        }
        beforeConstruction = undefined;
        service = open();
        expect((await current()).view.maintenance).toEqual(checkpoint);
        expect(
            (
                await service.getViewMaintenance({
                    corpusId,
                    receiptId: receipt.receiptId,
                })
            )?.job?.state,
        ).toBe("cancelled");
        const retried = await maintain();
        expect((await wait(retried.job!)).results[0].state).toBe("draft");
    });
    test("CLI maintenance still requires explicit developer opt-in", async () => {
        await service.close();
        await expect(
            runMemoryViewsCli([
                "--store",
                root,
                "plan-maintenance",
                "unused.json",
            ]),
        ).rejects.toThrow("--enable-view-drafts");
        service = open();
    });
});

test("bounded planning rejects pending, empty and overflow scopes and retains pinned compatibility", () => {
    const definition = {
        viewId: "wiki",
        kind: "wiki" as const,
        selector: { kind: "sources" as const, sources: [] },
        maintenance: policy,
    };
    expect(resolveViewMaintenance(definition, [], "model", {}).state).toBe(
        "blocked",
    );
    const sources = Array.from({ length: 33 }, (_, index) => ({
        sourceId: `s${index}`,
        corpusId: "c",
        sourceType: "text" as const,
        title: "Evidence",
        activeRevisionId: "r",
        tags: ["operations"],
        metadata: { viewSubjects: [alpha] },
        revisions: [
            {
                revisionId: "r",
                state: "ready",
                content: "Unresolved evidence",
                contentHash: "h",
                pipelineVersion: "1",
            },
        ],
    }));
    expect(
        resolveViewMaintenance(definition, sources, "model", {}).reason,
    ).toContain("32");
    sources[0].revisions[0].state = "processing";
    expect(
        resolveViewMaintenance(definition, sources.slice(0, 1), "model", {})
            .reason,
    ).toContain("pending");
    expect(
        resolveViewMaintenance(
            {
                ...definition,
                maintenance: { schemaVersion: 1, scope: { mode: "pinned" } },
            },
            sources,
            "model",
            {},
        ).state,
    ).toBe("pinned");
    const unsupported = structuredClone(definition);
    Object.assign(unsupported.maintenance, { schemaVersion: 2 });
    expect(() => validateMaintenanceDefinition(unsupported)).toThrow(
        "schema version",
    );
});

test("authoritative project/type/tag scopes and fixed source membership do not use relevance truncation", () => {
    const source = {
        sourceId: "s",
        corpusId: "c",
        sourceType: "text" as const,
        title: "Payments",
        activeRevisionId: "r",
        tags: ["operations", "reviewed"],
        metadata: { project: "checkout", viewSubjects: [alpha] },
        revisions: [
            {
                revisionId: "r",
                state: "ready",
                content: "Capacity unknown",
                contentHash: "h",
                pipelineVersion: "1",
            },
        ],
    };
    const definition = {
        viewId: "wiki",
        kind: "wiki" as const,
        selector: { kind: "sources" as const, sources: [] },
        maintenance: {
            ...policy,
            scope: {
                mode: "scopedSources" as const,
                project: "checkout",
                tags: ["operations", "reviewed"],
                sourceTypes: ["text" as const],
            },
        },
    };
    expect(
        resolveViewMaintenance(definition, [source], "model", {}).state,
    ).toBe("rebuild");
    const reviewed = {
        ...definition,
        maintenance: {
            ...definition.maintenance,
            wikiDiscovery: { ...policy.wikiDiscovery!, subjects: [alpha] },
        },
    };
    expect(
        resolveViewMaintenance(
            reviewed,
            [
                {
                    ...source,
                    metadata: {
                        ...source.metadata,
                        viewSubjects: [{ ...alpha, taxonomy: "concept" }],
                    },
                },
            ],
            "model",
            {},
        ).reason,
    ).toContain("taxonomy conflicts");
    expect(
        resolveViewMaintenance(
            definition,
            [{ ...source, metadata: { ...source.metadata, project: "other" } }],
            "model",
            {},
        ).state,
    ).toBe("blocked");
    expect(
        resolveViewMaintenance(
            definition,
            [{ ...source, tags: ["operations"] }],
            "model",
            {},
        ).state,
    ).toBe("blocked");
    const fixed = {
        ...definition,
        maintenance: {
            ...policy,
            scope: { mode: "currentSources" as const, sourceIds: ["s"] },
        },
    };
    expect(
        resolveViewMaintenance(
            fixed,
            [source, { ...source, sourceId: "new" }],
            "model",
            {},
        ).snapshot?.dependencies,
    ).toHaveLength(1);
    expect(resolveViewMaintenance(fixed, [], "model", {}).reason).toContain(
        "missing",
    );
    expect(
        resolveViewMaintenance(fixed, [source], "changed-model", {}).snapshot
            ?.fingerprint,
    ).not.toBe(
        resolveViewMaintenance(fixed, [source], "model", {}).snapshot
            ?.fingerprint,
    );
    expect(
        resolveViewMaintenance(
            fixed,
            [
                {
                    ...source,
                    revisions: [
                        { ...source.revisions[0], content: "x".repeat(120001) },
                    ],
                },
            ],
            "model",
            {},
        ).reason,
    ).toContain("120000");
    const overflow = {
        ...source,
        metadata: {
            viewSubjects: Array.from({ length: 33 }, (_, index) => ({
                ...alpha,
                key: `subject-${index}`,
            })),
        },
    };
    expect(
        resolveViewMaintenance(
            {
                ...fixed,
                maintenance: {
                    ...fixed.maintenance,
                    scope: { mode: "currentSources", sourceIds: ["s"] },
                },
            },
            [overflow],
            "model",
            {},
        ).state,
    ).toBe("blocked");
});
