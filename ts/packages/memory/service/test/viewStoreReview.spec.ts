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
import type { ProcedureSourceCitation } from "../src/types.js";
import type {
    ProcedureViewContent,
    TroubleshootingGuideContent,
    ViewEndpoint,
    ViewRelationshipInput,
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
