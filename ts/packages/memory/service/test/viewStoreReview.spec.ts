// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import {
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TypedViewStore } from "../src/personalHowToStore.js";
import { ViewHistory } from "../src/viewHistory.js";
import { mergeView, recordViewEdits } from "../src/viewMerge.js";
import type { ProcedureSourceCitation } from "../src/types.js";
import type {
    ProjectBriefContent,
    ProcedureViewContent,
    TroubleshootingGuideContent,
    ViewEndpoint,
    ViewRelationshipInput,
    ViewSynthesisOutput,
    ViewVersion,
} from "../src/viewTypes.js";

describe("foundation review regressions", () => {
    let root: string;
    let store: TypedViewStore;
    let failPublication: boolean;
    const corpusId = "review-corpus";
    beforeEach(async () => {
        root = await mkdtemp(path.join(os.tmpdir(), "memory-view-review-"));
        failPublication = false;
        store = new TypedViewStore(root, async () => {
            if (failPublication) throw new Error("Publication interrupted");
            return randomUUID();
        });
    });
    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    async function save(citations: ProcedureSourceCitation[]) {
        return store.save({
            corpusId,
            procedureId: "guide",
            document: {
                title: "Private diagnostic",
                steps: [
                    "Inspect the private evidence.",
                    "Confirm the outcome.",
                ],
                citations,
            },
        });
    }

    test.each(["policy", "publication", "cleanup", "all"])(
        "derived purge clears orphan %s state while preserving corpus defaults and runbooks",
        async (orphan) => {
            await save([{ sourceId: "retained-source", revisionId: "first" }]);
            const runbook = await store.get(corpusId, "guide");
            const history = new ViewHistory<Record<string, unknown>>(
                path.join(root, corpusId, "personal-how-to"),
                () => ({}),
            );
            const { head, state } = await history.read();
            state.publicationPolicy = {
                revision: 3,
                autoPublish: false,
                views:
                    orphan === "policy" || orphan === "all"
                        ? { "future-brief": { revision: 1, autoPublish: true } }
                        : {},
            };
            if (orphan === "publication" || orphan === "all")
                state.publications = {
                    "removed-brief": {
                        corpusId,
                        viewId: "removed-brief",
                        indexState: "pending",
                    },
                };
            if (orphan === "cleanup" || orphan === "all")
                state.viewIndexCleanup = ["removed-brief"];
            await history.commit(head, state, {}, "test", "Seed orphan state");

            await store.clearDerivedViews(corpusId);

            expect(await store.getViewPublicationPolicy(corpusId)).toEqual({
                revision: 3,
                autoPublish: false,
                views: {},
            });
            expect(await store.getViewIndexCleanup(corpusId)).toEqual([]);
            expect((await history.read()).state.publications).toEqual({});
            expect(await store.get(corpusId, "guide")).toEqual(runbook);
            for (const snapshot of await history.history()) {
                expect(snapshot.state.publicationPolicy).toEqual({
                    revision: 3,
                    autoPublish: false,
                    views: {},
                });
                expect(snapshot.state.publications).toEqual({});
                expect(snapshot.state.viewIndexCleanup ?? []).toEqual([]);
            }
            const purgedHead = (await history.read()).head;
            await store.clearDerivedViews(corpusId);
            expect((await history.read()).head).toBe(purgedHead);
        },
    );

    test.each(["a:b", "a"])(
        "colon-bearing source/revision pairs retain both dependencies and invalidate %s",
        async (sourceId) => {
            const sources = [
                { sourceId: "a:b", revisionId: "c" },
                { sourceId: "a", revisionId: "b:c" },
            ];
            await save(sources);
            expect(
                (await store.getView({ corpusId, viewId: "guide" }))?.definition
                    .selector.sources,
            ).toEqual(sources);
            await store.markStale(corpusId, sourceId, "replacement");
            expect((await store.get(corpusId, "guide"))?.state).toBe("stale");
        },
    );

    test("system dependency IDs distinguish exact revisions of the same source", async () => {
        const sources = [
            { sourceId: "evidence", revisionId: "first" },
            { sourceId: "evidence", revisionId: "second" },
        ];
        await save(sources);
        const view = await store.getView({ corpusId, viewId: "guide" });
        const dependencies = view?.relationships.filter(
            (edge) =>
                edge.origin === "system" && edge.predicate === "dependsOn",
        );
        expect(dependencies).toHaveLength(2);
        expect(new Set(dependencies?.map((edge) => edge.id)).size).toBe(2);
        expect(dependencies?.map((edge) => edge.to)).toEqual(
            sources.map((source) => ({ kind: "source", ...source })),
        );
    });

    test("public draft types reject unsupported edge directions and incomplete citations while procedures retain compatibility", () => {
        const sourceOriginAllowed: Extract<
            ViewEndpoint,
            { kind: "source" }
        > extends ViewRelationshipInput["from"]
            ? true
            : false = false;
        const sectionTargetAllowed: Extract<
            ViewEndpoint,
            { kind: "section" }
        > extends ViewRelationshipInput["to"]
            ? true
            : false = false;
        const incompleteDraftCitationAllowed: ProcedureSourceCitation extends TroubleshootingGuideContent["citations"][number]
            ? true
            : false = false;
        const compatibleProcedureCitationAllowed: ProcedureSourceCitation extends ProcedureViewContent["citations"][number]
            ? true
            : false = true;
        expect([
            sourceOriginAllowed,
            sectionTargetAllowed,
            incompleteDraftCitationAllowed,
            compatibleProcedureCitationAllowed,
        ]).toEqual([false, false, false, true]);
    });

    test.each(["purge-swapped", "purge-cleaned", "cleanup-failed"] as const)(
        "restart after %s removes old search text before clearing quarantine even with no surviving summaries",
        async (failure) => {
            await save([{ sourceId: "private-source", revisionId: "first" }]);
            const directory = path.join(root, corpusId, "personal-how-to");
            const index = path.join(directory, "search-index");
            await mkdir(index);
            await writeFile(path.join(index, "old.json"), "Private diagnostic");
            const empty = () => ({
                index: { candidates: [], procedures: [] },
                views: {},
            });
            const history = new ViewHistory(directory, empty, async (point) => {
                if (failure === point) throw new Error("Swap interrupted");
            });
            await expect(
                history.purge(
                    "private-source",
                    empty,
                    () => ({}),
                    async () => {
                        if (failure === "cleanup-failed")
                            throw new Error("Cleanup interrupted");
                        await rm(index, { recursive: true, force: true });
                    },
                ),
            ).rejects.toThrow("interrupted");
            if (failure === "purge-cleaned") {
                await expect(
                    readFile(path.join(index, "old.json"), "utf8"),
                ).rejects.toMatchObject({ code: "ENOENT" });
            } else {
                expect(
                    await readFile(path.join(index, "old.json"), "utf8"),
                ).toBe("Private diagnostic");
            }
            await expect(store.listViews(corpusId)).rejects.toThrow(
                "quarantined",
            );
            const restarted = new TypedViewStore(root, async () =>
                randomUUID(),
            );
            await restarted.recover(corpusId);
            expect(await restarted.list({ corpusId })).toEqual([]);
            expect(await readdir(directory)).toEqual(["view-history.git"]);
            await expect(
                readFile(path.join(index, "old.json"), "utf8"),
            ).rejects.toMatchObject({ code: "ENOENT" });
        },
    );

    test("failure after purge but before index publication cannot leave forgotten search text", async () => {
        await save([{ sourceId: "private-source", revisionId: "first" }]);
        const index = path.join(
            root,
            corpusId,
            "personal-how-to",
            "search-index",
        );
        await mkdir(index);
        await writeFile(path.join(index, "old.json"), "Private diagnostic");
        failPublication = true;
        await expect(
            store.forgetSource(corpusId, "private-source"),
        ).rejects.toThrow("Publication interrupted");
        await expect(
            readFile(path.join(index, "old.json"), "utf8"),
        ).rejects.toMatchObject({
            code: "ENOENT",
        });
        await store.recover(corpusId);
        expect(await store.list({ corpusId })).toEqual([]);
    });
});

describe("project brief item deletion merge regressions", () => {
    function fixture() {
        const content: ProjectBriefContent = {
            kind: "projectBrief",
            title: "Project risks",
            citations: [],
            sections: [
                {
                    id: "risks",
                    role: "risks",
                    heading: "Risks",
                    body: "Risk inventory",
                    details: {
                        kind: "risks",
                        items: [
                            { inventoryId: "retained", status: "open" },
                            { inventoryId: "removed", status: "open" },
                        ],
                    },
                },
            ],
        };
        const current: ViewVersion = {
            corpusId: "merge-corpus",
            viewId: "brief",
            revisionId: "human-revision",
            version: 2,
            state: "draft",
            createdAt: "2026-10-09T00:00:00.000Z",
            actor: "human",
            provenance: "human",
            definition: {
                viewId: "brief",
                revisionId: "definition",
                kind: "projectBrief",
                selector: { kind: "sources", sources: [] },
            },
            content: structuredClone(content),
            relationships: [],
            generation: {
                candidateId: "generated-base",
                fingerprint: "base-fingerprint",
                content,
                relationships: [],
            },
        };
        const human = structuredClone(content);
        const candidate: ViewSynthesisOutput = {
            content: structuredClone(content),
            relationships: [],
            outcome: "diagnosticOnly",
            missingEvidence: [],
        };
        return { current, human, candidate };
    }

    test.each(["generated", "human"])(
        "%s deletion of an unchanged item merges with another item's edit",
        (deletingSide) => {
            const { current, human, candidate } = fixture();
            const generated = candidate.content as ProjectBriefContent;
            const deleted = deletingSide === "generated" ? generated : human;
            const edited = deletingSide === "generated" ? human : generated;
            deleted.sections[0].details = {
                kind: "risks",
                items: [{ inventoryId: "retained", status: "open" }],
            };
            edited.sections[0].details = {
                kind: "risks",
                items: [
                    { inventoryId: "retained", status: "blocked" },
                    { inventoryId: "removed", status: "open" },
                ],
            };
            current.edits = recordViewEdits(current, human, [], "human");
            current.content = human;
            const merged = mergeView(current, candidate);
            expect(merged.conflicts).toEqual([]);
            expect(merged.output.content.sections[0].details).toEqual({
                kind: "risks",
                items: [{ inventoryId: "retained", status: "blocked" }],
            });
        },
    );

    test.each(["generated", "human"])(
        "%s deletion conflicts with an edit to that same item",
        (deletingSide) => {
            const { current, human, candidate } = fixture();
            const generated = candidate.content as ProjectBriefContent;
            const deleted = deletingSide === "generated" ? generated : human;
            const edited = deletingSide === "generated" ? human : generated;
            deleted.sections[0].details = {
                kind: "risks",
                items: [{ inventoryId: "retained", status: "open" }],
            };
            edited.sections[0].details = {
                kind: "risks",
                items: [
                    { inventoryId: "retained", status: "open" },
                    { inventoryId: "removed", status: "blocked" },
                ],
            };
            current.edits = recordViewEdits(current, human, [], "human");
            current.content = human;
            expect(mergeView(current, candidate).conflicts).toEqual([
                "section:risks",
            ]);
        },
    );
});
