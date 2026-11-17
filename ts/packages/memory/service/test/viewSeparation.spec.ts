// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { TypedViewStore } from "../src/viewStore.js";
import {
    separationProposal,
    separationChildInput,
    validateSeparationRequest,
    publicSeparation,
} from "../src/viewSeparation.js";
import { pendingSemanticReview } from "../src/viewSemanticReview.js";
import { viewHash } from "../src/viewMerge.js";
import type {
    ViewBuildSnapshot,
    ViewSemanticReview,
    ViewSynthesisOutput,
} from "../src/viewTypes.js";

const corpusId = "separation-corpus";
const citation = {
    sourceId: "evidence",
    revisionId: "original",
    locator: "chars:0-45",
    excerpt: "Acquisition and publication have separate roles.",
};
const input: ViewBuildSnapshot = {
    corpusId,
    actor: "owner",
    expectedVersion: 0,
    bounds: {},
    definition: {
        viewId: "overview",
        kind: "wiki",
        selector: {
            kind: "sources",
            sources: [
                {
                    sourceId: citation.sourceId,
                    revisionId: citation.revisionId,
                },
            ],
        },
        wiki: {
            construction: "informational-wiki-v1",
            query: "Acquisition and publication",
            aliases: [],
            excludedSourceIds: ["excluded"],
        },
    },
    inputs: [
        {
            ...citation,
            title: "Original evidence",
            content: citation.excerpt,
            contentHash: viewHash(citation.excerpt),
            passages: [citation],
        },
    ],
    influenceSources: [
        { sourceId: "read-not-cited", revisionId: "read-revision" },
    ],
    pipeline: "informational-wiki-v1",
    model: "test",
    fingerprint: "a".repeat(64),
};
const output: ViewSynthesisOutput = {
    content: {
        kind: "wiki",
        construction: "informational-wiki-v1",
        title: "Acquisition and publication",
        index: [{ pageId: "old-anchor", title: "Roles", taxonomy: "concept" }],
        sections: [
            {
                id: "old-anchor",
                role: "page",
                heading: "Roles",
                body: citation.excerpt,
                details: {
                    kind: "page",
                    construction: "informational-wiki-v1",
                    taxonomy: "concept",
                    note: "",
                    mergedPageIds: [],
                },
            },
        ],
        citations: [citation],
    },
    relationships: [],
    outcome: "knowledgePages",
    missingEvidence: [],
};
let root: string;
let store: TypedViewStore;

beforeEach(async () => {
    root = path.resolve(".test-artifacts", `view-separation-${randomUUID()}`);
    await mkdir(root, { recursive: true });
    store = new TypedViewStore(root, "owner");
});
afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

async function fixture(human = false) {
    const { job } = await store.admitViewBuild(
        {
            corpusId,
            expectedHead: null,
            targets: [{ definition: input.definition, expectedVersion: 0 }],
        },
        [structuredClone(input)],
    );
    await store.updateViewBuild(corpusId, job.jobId, (current) => {
        current.state = "running";
    });
    await store.materializeViewBuild(
        corpusId,
        job.jobId,
        "overview",
        output,
        output,
        [],
    );
    let view = (await store.getView({ corpusId, viewId: "overview" }))!;
    if (human) {
        const content = structuredClone(view.content);
        content.sections[0].body += " Human-authored qualification.";
        const edited = await store.saveViewDraft({
            corpusId,
            viewId: view.viewId,
            expectedHead: (await store.listViews(corpusId)).head,
            expectedVersion: view.version,
            definition: input.definition,
            content,
            relationships: [],
        });
        view = edited.version;
    }
    const review: ViewSemanticReview = {
        ...pendingSemanticReview(view),
        state: "complete",
        completedAt: "2026-11-15T00:00:00Z",
        assessment: {
            purpose: "Explain acquisition and publication",
            facets: [],
            gaps: [],
            separation: {
                reason: "Independently useful roles",
                destinations: ["Acquisition", "Publication"].map((purpose) => ({
                    purpose,
                    sectionIds: ["old-anchor"],
                    citations: [citation],
                })),
                unresolved: ["Human qualifications remain in the overview"],
            },
        },
    };
    await store.updateViewBuild(corpusId, job.jobId, (current) => {
        current.state = "complete";
        current.results[0].semanticReview = review;
    });
    const receipt = separationProposal(view, review, {
        ...structuredClone(input),
        expectedVersion: view.version,
        targetRevisionId: view.revisionId,
    });
    await store.prepareViewSeparation(
        receipt,
        (await store.listViews(corpusId)).head,
    );
    return { receipt, view, review, jobId: job.jobId };
}

async function confirm(receiptId: string) {
    await store.updateViewSeparation(corpusId, receiptId, (receipt) => {
        receipt.state = "confirmed";
        receipt.confirmedAt = new Date().toISOString();
    });
}

test("preview retains every anchor and human unit without changing the overview or creating children", async () => {
    const { receipt, view, review } = await fixture(true);
    expect(receipt.overview.retainedSectionIds).toEqual(["old-anchor"]);
    expect(receipt.overview.retainedHumanUnits.length).toBeGreaterThan(0);
    expect((await store.listViews(corpusId)).views).toEqual([view]);
    expect(await store.getView({ corpusId, viewId: view.viewId })).toEqual(
        view,
    );
    expect(publicSeparation(receipt)).not.toHaveProperty("input");
    const childInput = separationChildInput(receipt, 0);
    expect(childInput.editorial).toBeUndefined();
    expect(childInput.inputs).toEqual(receipt.input.inputs);
    expect(childInput.influenceSources).toEqual(receipt.input.influenceSources);
    expect(childInput.definition.wiki?.excludedSourceIds).toEqual(["excluded"]);
    expect(childInput.definition.viewId).toBe(receipt.destinations[0].viewId);
    expect(
        separationProposal(view, review, receipt.input).confirmationToken,
    ).toBe(receipt.confirmationToken);
    await expect(
        store.acceptSeparationChild(corpusId, receipt.receiptId, 0, output),
    ).rejects.toThrow("Separation is not confirmed or was cancelled");
});

test("restart resumes accepted destinations idempotently and activation requires every exact ready revision", async () => {
    const { receipt, view } = await fixture();
    await confirm(receipt.receiptId);
    const first = await store.acceptSeparationChild(
        corpusId,
        receipt.receiptId,
        0,
        output,
    );
    store = new TypedViewStore(root, "owner");
    await store.recoverViewBuilds(corpusId);
    expect((await store.listViewSeparations(corpusId))[0].state).toBe(
        "incomplete",
    );
    await confirm(receipt.receiptId);
    expect(
        (
            await store.acceptSeparationChild(
                corpusId,
                receipt.receiptId,
                0,
                output,
            )
        ).revisionId,
    ).toBe(first.revisionId);
    const second = await store.acceptSeparationChild(
        corpusId,
        receipt.receiptId,
        1,
        output,
    );
    await expect(
        store.activateViewSeparation(corpusId, receipt.receiptId),
    ).rejects.toThrow(
        "Separation destinations are not all accepted and index-ready",
    );
    for (const child of [first, second]) {
        await store.makeInformationalVisible(child);
        await expect(
            store.activateViewSeparation(corpusId, receipt.receiptId),
        ).rejects.toThrow(
            "Separation destinations are not all accepted and index-ready",
        );
        await store.updateViewIndex(corpusId, child.viewId, child.revisionId);
    }
    await store.activateViewSeparation(corpusId, receipt.receiptId);
    expect((await store.listViewSeparations(corpusId))[0].state).toBe("active");
    expect(await store.getView({ corpusId, viewId: "overview" })).toEqual(view);
    expect(
        await store.getViewVersions({ corpusId, viewId: first.viewId }),
    ).toHaveLength(1);
});

test.each(["read-not-cited", "excluded"])(
    "forgetting %s erases receipts and every staged destination",
    async (sourceId) => {
        const { receipt } = await fixture();
        await confirm(receipt.receiptId);
        await store.acceptSeparationChild(
            corpusId,
            receipt.receiptId,
            0,
            output,
        );
        await store.forgetSource(corpusId, sourceId);
        expect(await store.listViewSeparations(corpusId)).toEqual([]);
        for (const destination of receipt.destinations)
            expect(
                await store.getView({ corpusId, viewId: destination.viewId }),
            ).toBeUndefined();
        if (sourceId === "excluded")
            expect(
                await store.getView({ corpusId, viewId: "overview" }),
            ).toBeDefined();
    },
);

test("changed overview and cancellation prevent accepting further children", async () => {
    const { receipt, view } = await fixture();
    await confirm(receipt.receiptId);
    await store.updateViewSeparation(corpusId, receipt.receiptId, (current) => {
        current.state = "cancelled";
    });
    await expect(
        store.acceptSeparationChild(corpusId, receipt.receiptId, 0, output),
    ).rejects.toThrow("Separation is not confirmed or was cancelled");
    await confirm(receipt.receiptId);
    await store.saveViewDraft({
        corpusId,
        viewId: view.viewId,
        expectedHead: (await store.listViews(corpusId)).head,
        expectedVersion: view.version,
        definition: input.definition,
        content: { ...view.content, title: "Human changed title" },
        relationships: [],
    });
    await expect(
        store.acceptSeparationChild(corpusId, receipt.receiptId, 0, output),
    ).rejects.toThrow(
        "Separation overview changed; request and confirm a new preview",
    );
});

test("a prepared consolidation cannot retire a newly proposed separation participant", async () => {
    const { receipt, view, jobId } = await fixture();
    await store.updateViewBuild(corpusId, jobId, (job) => {
        job.results[0].wikiConsolidation = {
            identity: "prepared-before-preview",
            stage: "prepared",
            survivorViewId: view.viewId,
            retiringViewId: "other-article",
            retiringRevisionId: "other-revision",
            retiringVersion: 1,
            input: receipt.input,
            output,
            anchors: [],
            assessment: {
                relation: "samePurpose",
                reason: "same-scoped-purpose",
                scope: { system: "test", initiative: "", purpose: "test" },
                criticalDistinctions: [],
            },
            verification: { safe: true, failures: [] },
        };
    });
    await expect(
        store.acceptWikiConsolidation(corpusId, jobId, view.viewId),
    ).rejects.toThrow(
        "Separation participants cannot be consolidated automatically",
    );
    await expect(
        store.activateWikiRedirect(corpusId, jobId, view.viewId),
    ).rejects.toThrow(
        "Separation participants cannot become an automatic redirect",
    );
});

test("strict confirmation rejects extra execution fields and malformed guards", () => {
    const request = {
        operation: "confirm" as const,
        corpusId,
        receiptId: "split-proposal",
        expectedHead: "b".repeat(40),
        confirmationToken: "c".repeat(64),
    };
    expect(() => validateSeparationRequest(request)).not.toThrow();
    expect(() =>
        validateSeparationRequest({
            ...request,
            automatic: true,
        } as typeof request),
    ).toThrow("Invalid separation request fields");
    expect(() =>
        validateSeparationRequest({ ...request, confirmationToken: "" }),
    ).toThrow("Invalid separation confirmation token");
});
