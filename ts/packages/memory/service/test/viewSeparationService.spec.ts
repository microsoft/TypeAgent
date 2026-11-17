// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { viewHash } from "../src/viewMerge.js";
import { semanticReviewFacets } from "../src/viewSemanticReview.js";
import { TypedViewStore } from "../src/viewStore.js";
import { waitForTestState } from "./waitForTestState.js";
import {
    ConsolidationIndex,
    ingestFixture,
    offlineConsolidationAdapter,
} from "./wikiConsolidationFixtures.js";

test("confirmed separation survives partial generation and restart, checks real indexes, and invalidates revoked/forgotten influence", async () => {
    const root = path.resolve(
        ".test-artifacts",
        `separation-service-${randomUUID()}`,
    );
    await mkdir(root, { recursive: true });
    const { adapter } = offlineConsolidationAdapter();
    delete adapter.assessWikiConsolidation;
    delete adapter.checkWikiConsolidation;
    let fail = true;
    let childrenGenerated = 0;
    let authorized = true;
    const generate = adapter.generate;
    adapter.generate = async (...args) => {
        if (args[0].definition.viewId.startsWith("split-")) {
            childrenGenerated++;
            if (fail && childrenGenerated === 2)
                throw new Error("Injected second destination failure");
        }
        return generate(...args);
    };
    adapter.reviewInformational = async (input, view) => ({
        purpose: view.content.title,
        facets: semanticReviewFacets(input).map((id) => ({
            id,
            state: "covered",
            reason: "Original retained evidence",
            citations: input.inputs
                .flatMap((source) => source.passages ?? [])
                .slice(0, 1),
        })),
        gaps: [],
        separation: {
            reason: "Independently useful resource and review references",
            destinations: [
                "Connection resource scope",
                "Review approval scope",
            ].map((purpose) => ({
                purpose,
                sectionIds: [view.content.sections[0].id],
                citations: input.inputs
                    .flatMap((source) => source.passages ?? [])
                    .slice(0, 1),
            })),
            unresolved: ["Original human qualifications stay in the overview"],
        },
    });
    const open = () =>
        new FileMemoryService(root, {
            sourceSynopses: false,
            discoveryPolicy: "off",
            sourceAuthorization: async () => authorized,
            indexFactory: (_id, directory) => new ConsolidationIndex(directory),
            viewSynthesisAdapter: adapter,
        });
    let service = open();
    try {
        const { corpusId } = await service.createCorpus("Explicit separation");
        for (const family of ["wiki", "projects"] as const)
            await service.maintainViews({
                corpusId,
                family,
                operation: "pause",
                expectedHead: (await service.listViews(corpusId)).head,
            });
        await ingestFixture(
            service,
            corpusId,
            "initial",
            "document-021.md",
            "review",
        );
        const source = (await service.listSources(corpusId))[0];
        const job = await service.buildViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            targets: [
                {
                    expectedVersion: 0,
                    definition: {
                        viewId: "overview",
                        kind: "wiki",
                        selector: {
                            kind: "sources",
                            sources: [
                                {
                                    sourceId: source.sourceId,
                                    revisionId: source.activeRevisionId,
                                },
                            ],
                        },
                        wiki: {
                            construction: "informational-wiki-v1",
                            query: "lease-budget review",
                            aliases: [],
                            excludedSourceIds: [],
                        },
                    },
                },
            ],
        });
        const completed = await waitForTestState(
            () => service.getViewBuild({ corpusId, jobId: job.jobId }),
            (current) => current?.state !== "running",
            "Separation overview semantic review",
        );
        expect(completed?.results[0].semanticReview?.state).toBe("complete");
        const overview = (await service.getView({
            corpusId,
            viewId: "overview",
        }))!;
        const preview = await service.separateView({
            operation: "preview",
            corpusId,
            viewId: overview.viewId,
            expectedHead: (await service.listViews(corpusId)).head,
            expectedVersion: overview.version,
            revisionId: overview.revisionId,
        });
        const proposal = preview.proposal!;
        expect(childrenGenerated).toBe(0);
        await expect(
            service.separateView({
                operation: "confirm",
                corpusId,
                receiptId: proposal.receiptId,
                expectedHead: preview.head,
                confirmationToken: "0".repeat(64),
            }),
        ).rejects.toThrow(
            "Explicit confirmation must match this exact separation preview",
        );
        await expect(
            service.separateView({
                operation: "confirm",
                corpusId,
                receiptId: proposal.receiptId,
                expectedHead: preview.head,
                confirmationToken: proposal.confirmationToken,
            }),
        ).rejects.toThrow("Injected second destination failure");
        let progress = await service.separateView({
            operation: "read",
            corpusId,
            viewId: overview.viewId,
        });
        expect(progress.proposal?.state).toBe("incomplete");
        const firstRevision =
            progress.proposal?.destinations[0].acceptedRevisionId;
        expect(firstRevision).toBeDefined();
        expect(
            progress.proposal?.destinations[1].acceptedRevisionId,
        ).toBeUndefined();
        expect(
            (await service.getView({ corpusId, viewId: overview.viewId }))
                ?.content,
        ).toEqual(overview.content);
        await service.close();
        fail = false;
        service = open();
        await service.initialize();
        progress = await service.separateView({
            operation: "read",
            corpusId,
            viewId: overview.viewId,
        });
        let active = await service.separateView({
            operation: "confirm",
            corpusId,
            receiptId: proposal.receiptId,
            expectedHead: progress.head,
            confirmationToken: proposal.confirmationToken,
        });
        expect(active.proposal?.state).toBe("active");
        expect(active.proposal?.destinations[0].acceptedRevisionId).toBe(
            firstRevision,
        );
        const store = new TypedViewStore(root);
        expect(
            await store.getViewVersions({
                corpusId,
                viewId: proposal.destinations[0].viewId,
            }),
        ).toHaveLength(1);
        const destination = active.proposal!.destinations[0];
        await rm(
            path.join(
                root,
                corpusId,
                "views",
                "view-search-index",
                viewHash(destination.viewId),
                viewHash(destination.acceptedRevisionId),
                "ready",
            ),
        );
        progress = await service.separateView({
            operation: "read",
            corpusId,
            viewId: overview.viewId,
        });
        expect(progress.proposal?.state).toBe("incomplete");
        active = await service.separateView({
            operation: "confirm",
            corpusId,
            receiptId: proposal.receiptId,
            expectedHead: progress.head,
            confirmationToken: proposal.confirmationToken,
        });
        expect(active.proposal?.state).toBe("active");
        expect(childrenGenerated).toBe(3);
        authorized = false;
        await expect(
            service.separateView({
                operation: "read",
                corpusId,
                viewId: overview.viewId,
            }),
        ).rejects.toThrow("Native source authorization was revoked");
        expect((await store.listViewSeparations(corpusId))[0].state).toBe(
            "stale",
        );
        authorized = true;
        await store.forgetSource(corpusId, source.sourceId);
        expect(await store.listViewSeparations(corpusId)).toEqual([]);
        for (const child of proposal.destinations)
            expect(
                await store.getView({ corpusId, viewId: child.viewId }),
            ).toBeUndefined();
    } finally {
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
}, 90000);
