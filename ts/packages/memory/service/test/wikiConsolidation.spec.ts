// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    hydrateInformational,
    validateInformationalContent,
} from "../src/informationalWiki.js";
import { indexedLocator } from "../src/indexedFragments.js";
import {
    automaticallyConsolidatable,
    compatibleConsolidationPair,
    consolidationInput,
    parseConsolidationScope,
    preservedCanonicalOutput,
    readConsolidationScope,
    type WikiConsolidationReceipt,
} from "../src/wikiConsolidation.js";
import { TypedViewStore } from "../src/viewStore.js";
import {
    derivedDefinitionInput,
    authoredRelationships,
} from "../src/viewRelationships.js";
import { ViewBuildRunner } from "../src/viewBuilds.js";
import { EditorialRejection } from "../src/viewEditorial.js";
import { viewHash } from "../src/viewMerge.js";
import type { ViewBuildJob, ViewBuildSnapshot } from "../src/viewTypes.js";

function input(
    viewId: string,
    body = "Payments capacity review is open, not approved. Command median 38 ms differs from a held lease median 1750 ms. p95 acquisition 420 ms has a different cohort. Withdrawal is not a replacement value.",
    query = viewId,
): ViewBuildSnapshot {
    const block = {
        sourceId: "original",
        revisionId: "r1",
        blockOrdinal: 0,
        text: body,
        score: 1,
    };
    const citation = {
        sourceId: block.sourceId,
        revisionId: block.revisionId,
        locator: indexedLocator(block, 0, body.length),
        excerpt: body,
    };
    const captured = {
        corpusId: "corpus",
        actor: "authenticated-test-owner",
        definition: {
            viewId,
            kind: "wiki" as const,
            selector: {
                kind: "sources" as const,
                sources: [
                    { sourceId: block.sourceId, revisionId: block.revisionId },
                ],
            },
            wiki: {
                construction: "informational-wiki-v1" as const,
                query,
                aliases: [],
                excludedSourceIds: [],
            },
        },
        expectedVersion: 0,
        bounds: {},
        inputs: [
            {
                sourceId: block.sourceId,
                revisionId: block.revisionId,
                title: "Original indexed evidence",
                content: body,
                contentHash: viewHash(body),
                passages: [citation],
            },
        ],
        pipeline: "informational-wiki-v1" as const,
        model: "offline-core",
    };
    return { ...captured, fingerprint: viewHash(captured) };
}
function output(snapshot: ViewBuildSnapshot) {
    return hydrateInformational(snapshot, {
        summary: "Grounded reference summary.",
        status: "partial",
        title: snapshot.definition.viewId,
        prose: snapshot.inputs[0].content,
        limits: "Selected original indexed evidence",
        citationIds: ["f0"],
    });
}
async function preparedStore(root: string) {
    const store = new TypedViewStore(root, "authenticated-test-owner");
    const snapshots = [input("survivor"), input("retiring")];
    const request = {
        corpusId: "corpus",
        expectedHead: null,
        targets: snapshots.map((snapshot) => ({
            definition: snapshot.definition,
            expectedVersion: 0,
        })),
    };
    const admitted = await store.admitViewBuild(request, snapshots);
    for (const snapshot of snapshots)
        await store.materializeViewBuild(
            "corpus",
            admitted.job.jobId,
            snapshot.definition.viewId,
            output(snapshot),
            output(snapshot),
            [],
        );
    const survivor = (await store.getView({
        corpusId: "corpus",
        viewId: "survivor",
    }))!;
    const retiring = (await store.getView({
        corpusId: "corpus",
        viewId: "retiring",
    }))!;
    const captured = consolidationInput(survivor, retiring);
    const combined = preservedCanonicalOutput(survivor, retiring);
    const receipt: WikiConsolidationReceipt = {
        identity: viewHash(combined),
        stage: "prepared",
        survivorViewId: survivor.viewId,
        retiringViewId: retiring.viewId,
        retiringRevisionId: retiring.revisionId,
        retiringVersion: retiring.version,
        input: captured,
        output: combined.output,
        anchors: combined.anchors,
        assessment: {
            relation: "samePurpose",
            reason: "same-scoped-purpose",
            scope: {
                system: "Payments",
                initiative: "Capacity",
                purpose: "Same current review",
            },
            criticalDistinctions: [],
        },
        verification: { safe: true, failures: [] },
    };
    await store.updateViewBuild("corpus", admitted.job.jobId, (job) => {
        job.results[1].wikiConsolidation = receipt;
    });
    return { store, jobId: admitted.job.jobId, survivor, retiring, receipt };
}

test("bounded typed scope assessment rejects unsupported IDs, extra fields, contradictory scope and raw JSON diagnostics", async () => {
    const snapshot = input("subject");
    const valid = {
        relation: "samePurpose",
        reason: "same-scoped-purpose",
        scope: {
            system: "Payments",
            initiative: "",
            purpose: "Capacity review",
        },
        criticalDistinctions: [
            {
                fragmentId: "f0",
                statement: "Command is not lease; the review remains open",
            },
        ],
    };
    expect(parseConsolidationScope(valid, snapshot).relation).toBe(
        "samePurpose",
    );
    for (const invalid of [
        { ...valid, approve: true },
        { ...valid, scope: { ...valid.scope, system: "" } },
        { ...valid, reason: "distinct-scope" },
        { ...valid, relation: "distinct" },
        {
            ...valid,
            criticalDistinctions: [
                { fragmentId: "f20", statement: "Unsupported" },
            ],
        },
        {
            ...valid,
            criticalDistinctions: [
                valid.criticalDistinctions[0],
                valid.criticalDistinctions[0],
            ],
        },
    ])
        expect(() => parseConsolidationScope(invalid, snapshot)).toThrow(
            "invalid-scoped-purpose",
        );
    await expect(
        readConsolidationScope(
            Promise.reject(new SyntaxError("sensitive model response")),
            snapshot,
        ),
    ).rejects.toThrow("Wiki consolidation rejected: invalid-scoped-purpose");
});

test("bounded canonical retirement preserves every original link and rejects the first unreadable chain before acceptance", async () => {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "memory-consolidation-links-"),
    );
    try {
        const fixture = await preparedStore(root);
        let retiring = fixture.retiring;
        for (let links = 1; links <= 16; links++) {
            const snapshot = input(
                `canonical-${links}`,
                undefined,
                "Payments capacity review",
            );
            const admitted = await fixture.store.admitViewBuild(
                {
                    corpusId: "corpus",
                    expectedHead: (await fixture.store.listViews("corpus"))
                        .head,
                    targets: [
                        { definition: snapshot.definition, expectedVersion: 0 },
                    ],
                },
                [snapshot],
            );
            await fixture.store.materializeViewBuild(
                "corpus",
                admitted.job.jobId,
                snapshot.definition.viewId,
                output(snapshot),
                output(snapshot),
                [],
            );
            const survivor = (await fixture.store.getView({
                corpusId: "corpus",
                viewId: snapshot.definition.viewId,
            }))!;
            const captured = consolidationInput(survivor, retiring);
            const combined = preservedCanonicalOutput(survivor, retiring);
            const receipt: WikiConsolidationReceipt = {
                ...fixture.receipt,
                identity: viewHash(combined),
                stage: "prepared",
                survivorViewId: survivor.viewId,
                retiringViewId: retiring.viewId,
                retiringRevisionId: retiring.revisionId,
                retiringVersion: retiring.version,
                input: captured,
                output: combined.output,
                anchors: combined.anchors,
            };
            await fixture.store.updateViewBuild(
                "corpus",
                admitted.job.jobId,
                (job) => {
                    job.results[0].wikiConsolidation = receipt;
                },
            );
            if (links === 16) {
                const head = (await fixture.store.listViews("corpus")).head;
                await expect(
                    fixture.store.acceptWikiConsolidation(
                        "corpus",
                        admitted.job.jobId,
                        survivor.viewId,
                    ),
                ).rejects.toThrow("bounded old-link navigation");
                expect((await fixture.store.listViews("corpus")).head).toBe(
                    head,
                );
                expect(
                    (await fixture.store.getView({
                        corpusId: "corpus",
                        viewId: retiring.viewId,
                    }))!.redirect,
                ).toBeUndefined();
            } else {
                await fixture.store.acceptWikiConsolidation(
                    "corpus",
                    admitted.job.jobId,
                    survivor.viewId,
                );
                await fixture.store.activateWikiRedirect(
                    "corpus",
                    admitted.job.jobId,
                    survivor.viewId,
                );
                retiring = (await fixture.store.getView({
                    corpusId: "corpus",
                    viewId: survivor.viewId,
                }))!;
            }
        }
        let linked = (await fixture.store.getView({
            corpusId: "corpus",
            viewId: fixture.retiring.viewId,
        }))!;
        for (let links = 0; links < 15; links++) {
            expect(linked.redirect).toBeDefined();
            linked = (await fixture.store.getView({
                corpusId: "corpus",
                viewId: linked.redirect!.viewId,
            }))!;
        }
        expect(linked.viewId).toBe(retiring.viewId);
        expect(linked.redirect).toBeUndefined();
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("canonical acceptance precedes redirect; exact effect replay makes no duplicate revisions or commits", async () => {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "memory-consolidation-core-"),
    );
    try {
        const { store, jobId, survivor, retiring, receipt } =
            await preparedStore(root);
        expect(
            (await store.getView({
                corpusId: "corpus",
                viewId: retiring.viewId,
            }))!.redirect,
        ).toBeUndefined();
        const accepted = await store.acceptWikiConsolidation(
            "corpus",
            jobId,
            retiring.viewId,
        );
        expect(accepted.version).toBe(2);
        expect(accepted.actor).toBe("memory-view-generator");
        expect(
            (await store.getView({
                corpusId: "corpus",
                viewId: retiring.viewId,
            }))!.state,
        ).toBe("draft");
        const head = (await store.listViews("corpus")).head;
        expect(
            (
                await store.acceptWikiConsolidation(
                    "corpus",
                    jobId,
                    retiring.viewId,
                )
            ).revisionId,
        ).toBe(accepted.revisionId);
        expect((await store.listViews("corpus")).head).toBe(head);
        await store.activateWikiRedirect("corpus", jobId, retiring.viewId);
        const alias = (await store.getView({
            corpusId: "corpus",
            viewId: retiring.viewId,
        }))!;
        expect(alias.state).toBe("archived");
        expect(alias.redirect?.viewId).toBe(survivor.viewId);
        expect(alias.generation?.input?.inputs).toEqual(receipt.input.inputs);
        const redirectedHead = (await store.listViews("corpus")).head;
        await store.activateWikiRedirect("corpus", jobId, retiring.viewId);
        expect((await store.listViews("corpus")).head).toBe(redirectedHead);
        for (const original of [survivor, retiring])
            for (const section of original.content.sections)
                expect(
                    accepted.content.sections.some(
                        (retained) => retained.body === section.body,
                    ),
                ).toBe(true);
        if (accepted.content.kind !== "wiki")
            throw new Error("Expected canonical Wiki");
        validateInformationalContent(accepted.content);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test.each(["survivor", "retiring"])(
    "authenticated %s edit between preparation and acceptance denies every retirement effect",
    async (viewId) => {
        const root = await mkdtemp(
            path.join(os.tmpdir(), "memory-consolidation-edit-"),
        );
        try {
            const { store, jobId, survivor, retiring } =
                await preparedStore(root);
            const current = viewId === survivor.viewId ? survivor : retiring;
            const content = {
                ...current.content,
                title: "Deliberate human title",
            };
            await store.saveViewDraft({
                corpusId: "corpus",
                viewId,
                expectedHead: (await store.listViews("corpus")).head,
                expectedVersion: current.version,
                definition: derivedDefinitionInput(current),
                content,
                relationships: authoredRelationships(current),
            });
            const head = (await store.listViews("corpus")).head;
            await expect(
                store.acceptWikiConsolidation("corpus", jobId, retiring.viewId),
            ).rejects.toThrow("authorship changed");
            expect((await store.listViews("corpus")).head).toBe(head);
            expect(
                (await store.getView({
                    corpusId: "corpus",
                    viewId: retiring.viewId,
                }))!.redirect,
            ).toBeUndefined();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    },
);

test("historical human edits, mismatched exclusions and corrupted consolidation indexes never establish equivalence", async () => {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "memory-consolidation-history-"),
    );
    try {
        const { survivor, retiring, receipt } = await preparedStore(root);
        const history = [
            {
                commitId: "old",
                version: { ...survivor, provenance: "human" as const },
            },
            { commitId: "current", version: survivor },
        ];
        expect(automaticallyConsolidatable(survivor, history)).toBe(false);
        const excluded = structuredClone(retiring);
        excluded.definition.wiki!.excludedSourceIds = ["original"];
        expect(compatibleConsolidationPair(survivor, excluded)).toBe(false);
        const malformed = structuredClone(receipt.output.content);
        if (malformed.kind !== "wiki") throw new Error("Expected Wiki");
        malformed.sections[0].details.mergedPageIds = ["missing-page"];
        expect(() => validateInformationalContent(malformed)).toThrow(
            "exact accepted consolidation index",
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("forgetting an uncited influence purges canonical, redirect, history and prepared/committed receipts", async () => {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "memory-consolidation-influence-"),
    );
    try {
        const { store, jobId, retiring, survivor } = await preparedStore(root);
        await store.updateViewBuild("corpus", jobId, (job) => {
            job.results[1].wikiConsolidation!.input.influenceSources = [
                { sourceId: "uncited", revisionId: "r1" },
            ];
        });
        await store.acceptWikiConsolidation("corpus", jobId, retiring.viewId);
        await store.activateWikiRedirect("corpus", jobId, retiring.viewId);
        await store.forgetSource("corpus", "uncited");
        for (const view of [survivor, retiring]) {
            expect(
                await store.getView({
                    corpusId: "corpus",
                    viewId: view.viewId,
                }),
            ).toBeUndefined();
            expect(
                await store.getViewHistory({
                    corpusId: "corpus",
                    viewId: view.viewId,
                }),
            ).toEqual([]);
        }
        expect(await store.getViewBuild("corpus", jobId)).toBeUndefined();
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test.each([
    "quantity",
    "statistic-cohort",
    "command-lease",
    "scope-state",
    "correction-withdrawal",
] as const)(
    "%s actual-output rejection is a parked technical target, not user approval, and independent targets continue",
    async (failure) => {
        const snapshots = [input("unsafe"), input("independent")];
        const job: ViewBuildJob = {
            jobId: "offline",
            corpusId: "corpus",
            fingerprint: "offline",
            request: {
                corpusId: "corpus",
                expectedHead: null,
                targets: snapshots.map((snapshot) => ({
                    definition: snapshot.definition,
                    expectedVersion: 0,
                })),
            },
            actor: "authenticated-owner",
            createdAt: "offline",
            updatedAt: "offline",
            state: "running",
            publication: false,
            results: snapshots.map((snapshot) => ({
                viewId: snapshot.definition.viewId,
                snapshot,
                state: "pending",
                reason: "Pending",
            })),
        };
        let finish: () => void = () => {
            throw new Error("Offline completion callback is not initialized");
        };
        const finished = new Promise<void>((resolve) => {
            finish = resolve;
        });
        const runner = new ViewBuildRunner(
            {
                identity: "offline",
                generate: async (snapshot) => output(snapshot),
                validate: async () => {
                    throw new Error("No universal support checker");
                },
            },
            {
                update: async (_corpus, _job, update) => {
                    update(job);
                    if (job.state !== "running") finish();
                    return job;
                },
                current: async () => undefined,
                materialize: async (_job, target) => {
                    job.results.find(
                        (result) => result.viewId === target.viewId,
                    )!.state = "draft";
                },
                consolidateWiki: async (_job, target) => {
                    if (target.viewId === "unsafe")
                        throw new EditorialRejection("critical-distinction", [
                            failure,
                        ]);
                },
            },
        );
        runner.start(job);
        await finished;
        await runner.close();
        expect(job.results[0].state).toBe("blocked");
        expect(job.results[0].conflictId).toBeUndefined();
        expect(job.results[1].state).toBe("draft");
        expect(job.results[0].reason).not.toMatch(/approval|user decision/i);
    },
);
