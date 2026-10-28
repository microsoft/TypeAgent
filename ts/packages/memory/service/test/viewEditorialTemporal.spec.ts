// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { hydrateInformational } from "../src/informationalWiki.js";
import { hydrateProjectSummary } from "../src/informationalProject.js";
import {
    indexedLocator,
    parseIndexedLocator,
} from "../src/indexedFragments.js";
import {
    authoredRelationships,
    derivedDefinitionInput,
} from "../src/viewRelationships.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";
import type {
    IndexedFragmentRequest,
    IndexedFragmentSelection,
} from "../src/types.js";
import type {
    ViewBuildSnapshot,
    ViewSynthesisOutput,
    ViewVersion,
    WikiSubjectAssessment,
} from "../src/viewTypes.js";
import type {
    ViewEditorialAssessment,
    ViewEditorialContext,
} from "../src/viewEditorial.js";
import { editorialProtection } from "../src/viewEditorial.js";
import { ViewBuildStaleError } from "../src/viewBuilds.js";
import { originalFixtureRoot } from "./wikiConsolidationFixtures.js";

const targets = [
    { term: "command", sourceId: "worksheet" },
    { term: "lease", sourceId: "worksheet" },
    { term: "Orders", sourceId: "handoff", initiative: true },
    { term: "routing", sourceId: "temporary" },
];

class EditorialIndex extends FakeSemanticCorpusIndex {
    async listSubjects(offset: number) {
        const items = targets.filter((target) =>
            this.documents.some(
                (document) => document.source.sourceId === target.sourceId,
            ),
        );
        return {
            total: items.length,
            items: offset
                ? []
                : items.map((target) => ({
                      term: target.term,
                      sourceIds: [target.sourceId],
                      postingCount: 1,
                      ...(target.initiative ? { initiative: true } : {}),
                  })),
        };
    }
    override async getKnowledgeGraph() {
        return {
            entities: [],
            relationships: [],
            topics: targets
                .filter((target) =>
                    this.documents.some(
                        (document) =>
                            document.source.sourceId === target.sourceId,
                    ),
                )
                .map((target) => ({
                    name: target.term,
                    sourceIds: [target.sourceId],
                    mentionCount: 1,
                })),
        };
    }
    async readFragments(
        request: IndexedFragmentRequest,
    ): Promise<IndexedFragmentSelection> {
        const target = targets.find((entry) =>
            request.terms.some(
                (term) => term.toLowerCase() === entry.term.toLowerCase(),
            ),
        );
        if (!target) throw new Error("Unexpected offline editorial query");
        const document = this.documents.find(
            (entry) => entry.source.sourceId === target.sourceId,
        );
        if (!document) return { fragments: [], readChars: 0, limited: false };
        const block = {
            sourceId: document.source.sourceId,
            revisionId: document.revision.revisionId,
            blockOrdinal: 0,
            text: document.content,
            score: 1,
        };
        const tail = document.content.indexOf("Governing tail exception:");
        const offsets = [...new Set([0, ...(tail >= 0 ? [tail] : [])])].slice(
            0,
            request.maxFragments ?? 12,
        );
        const fragments = offsets.map((start) => {
            let end = Math.min(
                document.content.length,
                start + Math.min(1600, request.maxCharsPerFragment ?? 2000),
            );
            if (/[\uD800-\uDBFF]/.test(document.content[end - 1])) end--;
            return {
                sourceId: block.sourceId,
                revisionId: block.revisionId,
                locator: indexedLocator(block, start, end),
                snippet: document.content.slice(start, end),
                score: 1,
            };
        });
        return {
            fragments,
            readChars: fragments.reduce(
                (sum, fragment) => sum + fragment.snippet.length,
                0,
            ),
            limited:
                document.content.length >
                fragments.reduce(
                    (sum, fragment) => sum + fragment.snippet.length,
                    0,
                ),
        };
    }
    async resolveIndexedLocator(
        sourceId: string,
        revisionId: string,
        locator: string,
    ) {
        const range = parseIndexedLocator(locator);
        const document = this.documents.find(
            (entry) =>
                entry.source.sourceId === sourceId &&
                entry.revision.revisionId === revisionId,
        );
        if (
            !document ||
            locator !==
                indexedLocator(
                    {
                        sourceId,
                        revisionId,
                        blockOrdinal: 0,
                        text: document.content,
                        score: 1,
                    },
                    range.start,
                    range.end,
                )
        )
            throw new Error(
                "Original indexed editorial reference is obsolete or missing",
            );
        return document.content.slice(range.start, range.end);
    }
}

async function settled(service: FileMemoryService, corpusId: string) {
    const maintenance = await service.drainMaintenance(15_000);
    if (
        maintenance.reason ||
        maintenance.pending.length ||
        maintenance.running.length
    )
        throw new Error(
            `Offline editorial maintenance did not drain: ${JSON.stringify(maintenance)}`,
        );
    for (let attempt = 0; attempt < 1000; attempt++) {
        const snapshot = await service.listViews(corpusId);
        const running = (await service.listViewBuilds(corpusId)).some(
            (job) => job.state === "running",
        );
        // Family pending also includes conflicts awaiting a human decision.
        if (!running) return snapshot;
        await new Promise((resolve) => setTimeout(resolve, 20));
    }

    throw new Error(
        `Offline editorial maintenance did not settle: ${JSON.stringify(
            (await service.listViewBuilds(corpusId)).slice(0, 3).map((job) => ({
                state: job.state,
                results: job.results.map((result) => ({
                    state: result.state,
                    reason: result.reason,
                })),
            })),
        )}`,
    );
}

async function maintainFamily(
    service: FileMemoryService,
    corpusId: string,
    family: "wiki" | "projects",
    operation: "pause" | "resume",
) {
    for (let attempt = 0; attempt < 20; attempt++) {
        try {
            return await service.maintainViews({
                corpusId,
                family,
                operation,
                expectedHead: (await service.listViews(corpusId)).head,
            });
        } catch (error) {
            if (
                !(error instanceof ViewBuildStaleError) ||
                error.message !== "Wiki-family history head changed"
            )
                throw error;
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
    }
    throw new Error(
        "Concurrent offline family setup did not acquire its guarded head",
    );
}

test("actual P0 revisions automate correction/withdrawal around human edits and preserve independent project scope", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "memory-editorial-p0-"));
    const inputs: Array<
        ViewBuildSnapshot & { editorial?: ViewEditorialContext }
    > = [];
    const checks: string[] = [];
    let overlap = false;
    let unsafe = false;
    let holdRouting = false;
    let routingEntered = false;
    let releaseRouting: () => void = () => {
        throw new Error("Routing pause was not initialized");
    };
    const routingRelease = new Promise<void>((resolve) => {
        releaseRouting = resolve;
    });
    const adapter = {
        identity: "offline-editorial-P0",
        generateTopics: async () => {
            throw new Error(
                "Offline editorial index does not expose complete topic incidence",
            );
        },
        assessWikiSubject: async (): Promise<WikiSubjectAssessment> => ({
            disposition: "distinct",
            canonicalViewId: "",
            purpose: "Independent scoped explanation",
            reason: "Command, lease and routing are distinct scopes",
            sharedFragmentIds: [],
            essentialDistinctions: [],
            ambiguousViewIds: [],
        }),
        generate: async (
            input: ViewBuildSnapshot & { editorial?: ViewEditorialContext },
        ) => {
            inputs.push(structuredClone(input));
            if (holdRouting && input.definition.wiki?.query === "routing") {
                routingEntered = true;
                await routingRelease;
            }
            const fragments = input.inputs.flatMap(
                (source) => source.passages ?? [],
            );
            const body = fragments
                .map((fragment) => fragment.excerpt)
                .join("\n\n");
            let title =
                input.editorial?.generatedBase.content.title ??
                (input.definition.wiki ?? input.definition.projectSummary)!
                    .query;
            if (overlap && input.definition.wiki?.query === "lease")
                title = "Agent attempted protected-title overwrite";
            const citationIds = fragments.map(
                (_fragment, index) => `f${index}`,
            );
            if (input.definition.projectSummary)
                return hydrateProjectSummary(input, {
                    summary: "Grounded project summary.",
                    completeness: "partial",
                    assignments: [],
                    milestoneItems: [],
                    decisionItems: [],
                    openQuestions: [],
                    riskItems: [],
                    title,
                    goalsScope: body,
                    owners: "Accountable service owner unknown; review owners are scoped in the evidence.",
                    status: body,
                    milestones: "Production cutover date unknown",
                    decisions: body,
                    risks: "Stale verifier caches remain distinct from local compatibility acceptance",
                    context:
                        "Current original indexed handoff evidence, not synopsis prose",
                    limits: "Selected original indexed evidence only",
                    projectState: "unknown",
                    incidentState: "unknown",
                    capacityState: "notApplicable",
                    citationIds,
                });
            return hydrateInformational(input, {
                summary: "Grounded reference summary.",
                status: "partial",
                title,
                prose:
                    unsafe && input.definition.wiki?.query === "command"
                        ? "The current command median is 1850 ms; command time is identical to the held lease and approves rollout."
                        : body,
                limits: "Selected original indexed evidence only",
                citationIds,
            });
        },
        checkEditorial: async (
            input: ViewBuildSnapshot,
            output: ViewSynthesisOutput,
        ): Promise<ViewEditorialAssessment> => {
            checks.push(
                (input.definition.wiki ?? input.definition.projectSummary)!
                    .query,
            );
            if (
                output.content.sections.some((section) =>
                    section.body.includes("current command median is 1850 ms"),
                )
            )
                return {
                    safe: false,
                    failures: [
                        "statistic-cohort",
                        "command-lease",
                        "scope-state",
                        "correction-withdrawal",
                    ],
                };
            return { safe: true, failures: [] };
        },
        validate: async () => {
            throw new Error(
                "Editorial informational updates must not call universal inventory support",
            );
        },
    };
    const open = () =>
        new FileMemoryService(root, {
            sourceSynopses: false,
            discoveryPolicy: "off",
            indexFactory: (_id, directory) => new EditorialIndex(directory),
            eventIndexFactory: (_id, directory) =>
                new FakeSemanticCorpusIndex(directory),
            viewSynthesisAdapter: adapter,
        });
    let service = open();
    try {
        const { corpusId } = await service.createCorpus(
            "Actual P0 editorial offline",
        );
        for (const family of ["wiki", "projects"] as const)
            await maintainFamily(service, corpusId, family, "pause");
        const ingest = async (
            stage: string,
            file: string,
            sourceId: string,
        ) => {
            const text = await readFile(
                path.join(originalFixtureRoot(), stage, file),
                "utf8",
            );
            expect(text).not.toContain("MAINTENANCE_EVALUATOR_ONLY");
            const existing = (await service.listSources(corpusId)).find(
                (source) => source.sourceId === sourceId,
            );
            const source = {
                sourceType: "markdown" as const,
                title: sourceId,
                text,
            };
            const job = existing
                ? await service.replaceSource({
                      corpusId,
                      sourceId,
                      expectedActiveRevisionId: existing.activeRevisionId,
                      source,
                  })
                : await service.ingestDocument({
                      corpusId,
                      source: { ...source, sourceId },
                  });
            expect((await waitForMemoryJob(service, job.jobId)).state).toBe(
                "complete",
            );
        };
        await ingest("initial", "document-020.md", "worksheet");
        await ingest("initial", "document-022.md", "handoff");
        await ingest("initial", "document-023.md", "temporary");
        for (const family of ["wiki", "projects"] as const)
            await maintainFamily(service, corpusId, family, "resume");
        const initial = await settled(service, corpusId);
        const page = (views: ViewVersion[], query: string) => {
            const found = views.find(
                (view) =>
                    (
                        view.definition.wiki ?? view.definition.projectSummary
                    )?.query.toLowerCase() === query.toLowerCase(),
            );
            if (!found)
                throw new Error(
                    "Expected actual runtime-selected editorial target",
                );
            return found;
        };
        const command = page(initial.views, "command");
        const lease = page(initial.views, "lease");
        expect(command.content.sections[0].body).toContain("38 ms");
        const edited = structuredClone(lease.content);
        edited.title = "My deliberate capacity review";
        if (edited.kind !== "wiki")
            throw new Error("Expected an actual Wiki target");
        edited.sections[0].details.note =
            "Personal synthetic review annotation";
        const human = await service.saveViewDraft({
            corpusId,
            viewId: lease.viewId,
            expectedVersion: lease.version,
            expectedHead: (await service.listViews(corpusId)).head,
            definition: derivedDefinitionInput(lease),
            content: edited,
            relationships: authoredRelationships(lease),
        });
        expect(human.version.provenance).toBe("human");
        expect(human.version.actor).not.toBe("memory-view-generator");
        await ingest("t1", "document-020.md", "worksheet");
        await ingest("t1", "document-022.md", "handoff");
        const t1 = await settled(service, corpusId);
        const corrected = page(t1.views, "lease");
        expect(corrected.viewId).toBe(lease.viewId);
        expect(corrected.content.title).toBe(edited.title);
        expect(corrected.content.sections[0].details).toMatchObject({
            note: "Personal synthetic review annotation",
        });
        expect(corrected.content.sections[0].body).toContain("41 ms");
        expect(corrected.actor).toBe("memory-view-generator");
        expect(corrected.provenance).toBe("merged");
        expect(corrected.generation?.content.title).not.toBe(edited.title);
        expect(editorialProtection(corrected)).toContain("title");
        expect(
            inputs.some(
                (input) =>
                    input.editorial?.generatedBaseId ===
                    lease.generation?.candidateId,
            ),
        ).toBe(true);
        expect(checks).toContain("command");
        expect(page(t1.views, "command").content.sections[0].body).toContain(
            "41 ms",
        );
        expect(page(t1.views, "command").provenance).toBe("generated");
        overlap = true;
        const proposedDefinition = derivedDefinitionInput(corrected);
        if (!proposedDefinition.wiki)
            throw new Error("Expected actual protected Wiki definition");
        proposedDefinition.wiki.aliases = ["held connection ownership"];
        let proposal = await service.buildViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            targets: [
                {
                    definition: proposedDefinition,
                    expectedVersion: corrected.version,
                },
            ],
        });
        for (
            let attempt = 0;
            proposal.state === "running" && attempt < 500;
            attempt++
        ) {
            await new Promise((resolve) => setTimeout(resolve, 20));
            proposal = (await service.getViewBuild({
                corpusId,
                jobId: proposal.jobId,
            }))!;
        }
        overlap = false;
        expect(proposal.results[0].state).toBe("conflicted");
        const conflict = await service.getViewConflict({
            corpusId,
            conflictId: proposal.results[0].conflictId!,
        });
        expect(conflict?.targets).toContain("title");
        expect(conflict?.human.content.title).toBe(edited.title);
        await ingest("t2", "document-020.md", "worksheet");
        await ingest("t2", "document-022.md", "handoff");
        const t2 = await settled(service, corpusId);
        const withdrawn = page(t2.views, "lease");
        expect(withdrawn.content.sections[0].body).toContain("withdrawn");
        expect(withdrawn.content.sections[0].body).toContain("denominator");
        expect(withdrawn.content.title).toBe(edited.title);
        if (
            !t2.views.some(
                (view) =>
                    view.definition.projectSummary?.query.toLowerCase() ===
                    "orders",
            )
        )
            throw new Error(
                `Orders target missing: ${JSON.stringify(
                    (await service.listViewBuilds(corpusId)).flatMap((job) =>
                        job.results
                            .filter(
                                (result) =>
                                    result.snapshot.definition.projectSummary,
                            )
                            .map((result) => ({
                                state: result.state,
                                reason: result.reason,
                            })),
                    ),
                )}`,
            );
        const orders = page(t2.views, "Orders");
        const prose = orders.content.sections
            .map((section) => section.body)
            .join("\n");
        expect(prose).toContain("only local compatibility");
        expect(prose).toContain("Orders rollout is");
        expect(prose).toContain("cutover date remains unknown");
        const source = (await service.listSources(corpusId)).find(
            (entry) => entry.sourceId === "worksheet",
        )!;
        expect(
            withdrawn.content.citations.every(
                (citation) => citation.revisionId === source.activeRevisionId,
            ),
        ).toBe(true);
        const currentCommand = page(t2.views, "command");
        const invalidDefinition = derivedDefinitionInput(currentCommand);
        if (!invalidDefinition.wiki)
            throw new Error("Expected actual unprotected Wiki definition");
        invalidDefinition.wiki.aliases = ["command duration"];
        unsafe = true;
        let rejected = await service.buildViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            targets: [
                {
                    definition: invalidDefinition,
                    expectedVersion: currentCommand.version,
                },
            ],
        });
        for (
            let attempt = 0;
            rejected.state === "running" && attempt < 500;
            attempt++
        ) {
            await new Promise((resolve) => setTimeout(resolve, 20));
            rejected = (await service.getViewBuild({
                corpusId,
                jobId: rejected.jobId,
            }))!;
        }
        unsafe = false;
        expect(rejected.results[0].state).toBe("blocked");
        expect(rejected.results[0].reason).toContain("critical-distinction");
        expect(rejected.results[0].reason).not.toContain(
            "current command median is 1850",
        );
        expect(
            (await service.getView({ corpusId, viewId: currentCommand.viewId }))
                ?.revisionId,
        ).toBe(currentCommand.revisionId);
        const settledAfterRejection = await settled(service, corpusId);
        const calls = inputs.length;
        const revisions = settledAfterRejection.views
            .map((view) => view.revisionId)
            .sort();
        await service.close();
        service = open();
        await service.initialize();
        const restarted = await settled(service, corpusId);
        expect(inputs).toHaveLength(calls);
        expect(restarted.views.map((view) => view.revisionId).sort()).toEqual(
            revisions,
        );
        const protectedLease = page(restarted.views, "lease");
        const unlock = {
            corpusId,
            viewId: protectedLease.viewId,
            expectedVersion: protectedLease.version,
            expectedHead: restarted.head,
            definition: derivedDefinitionInput(protectedLease),
            content: protectedLease.content,
            relationships: authoredRelationships(protectedLease),
            unlockProtection: ["title"],
        };
        const forgedActor = { ...unlock, actor: "memory-view-generator" };
        await expect(service.saveViewDraft(forgedActor)).rejects.toThrow(
            "authenticated service",
        );
        await expect(
            service.saveViewDraft({
                ...unlock,
                unlockProtection: ["invented-unit"],
            }),
        ).rejects.toThrow("Invalid or unknown");
        const unlocked = await service.saveViewDraft(unlock);
        expect(unlocked.version.provenance).toBe("human");
        expect(unlocked.version.content.title).toBe(edited.title);
        expect(
            (
                await service.getViewPublication({
                    corpusId,
                    viewId: protectedLease.viewId,
                })
            ).blockedReason,
        ).toContain("pending merge conflict");
        const followingUnlock = page(
            (await settled(service, corpusId)).views,
            "lease",
        );
        expect(followingUnlock.content.title).toBe(
            protectedLease.generation?.content.title,
        );
        expect(editorialProtection(followingUnlock)).not.toContain("title");
        expect(editorialProtection(followingUnlock)).toContain(
            `section:${followingUnlock.content.sections[0].id}:note`,
        );
        const routing = page(
            (await settled(service, corpusId)).views,
            "routing",
        );
        const routingDefinition = derivedDefinitionInput(routing);
        if (!routingDefinition.wiki)
            throw new Error("Expected indexed routing Wiki");
        routingDefinition.wiki.aliases = ["temporary routing"];
        holdRouting = true;
        await service.buildViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            targets: [
                {
                    definition: routingDefinition,
                    expectedVersion: routing.version,
                },
            ],
        });
        for (let attempt = 0; !routingEntered && attempt < 250; attempt++)
            await new Promise((resolve) => setTimeout(resolve, 20));
        expect(routingEntered).toBe(true);
        const routingForget = await service.previewForgetSource(
            corpusId,
            "temporary",
        );
        await service.forgetSource({
            corpusId,
            sourceId: "temporary",
            confirmationToken: routingForget.confirmationToken,
        });
        expect(
            await service.getView({ corpusId, viewId: routing.viewId }),
        ).toBeUndefined();
        releaseRouting();
        await settled(service, corpusId);
        expect(
            await service.getView({ corpusId, viewId: routing.viewId }),
        ).toBeUndefined();
        expect(
            await service.getViewHistory({ corpusId, viewId: routing.viewId }),
        ).toEqual([]);
        const preview = await service.previewForgetSource(
            corpusId,
            "worksheet",
        );
        await service.forgetSource({
            corpusId,
            sourceId: "worksheet",
            confirmationToken: preview.confirmationToken,
        });
        expect(
            await service.getView({ corpusId, viewId: lease.viewId }),
        ).toBeUndefined();
        expect(
            await service.getViewHistory({ corpusId, viewId: lease.viewId }),
        ).toEqual([]);
    } finally {
        releaseRouting();
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
}, 120000);
