// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    writeFile,
} from "node:fs/promises";
import path from "node:path";
import { TypedViewStore } from "../src/viewStore.js";
import { viewHash } from "../src/viewMerge.js";
import type { ViewSaveRequest } from "../src/viewTypes.js";

test("View privacy cleanup preserves retained generation segments and removes forgotten index roots including segments", async () => {
    const root = await mkdtemp(path.join(process.cwd(), ".b11-view-segments-"));
    try {
        const store = new TypedViewStore(root);
        let head: string | null = null;
        const indexRoot = path.join(
            root,
            "corpus",
            "views",
            "view-search-index",
        );
        for (const viewId of ["forgotten", "retained"]) {
            const request: ViewSaveRequest = {
                corpusId: "corpus",
                viewId,
                expectedHead: head,
                expectedVersion: 0,
                definition: {
                    viewId,
                    kind: "troubleshootingGuide",
                    selector: {
                        kind: "sources",
                        sources: [
                            {
                                sourceId: `${viewId}-source`,
                                revisionId: "source-revision",
                            },
                        ],
                    },
                },
                content: {
                    kind: "troubleshootingGuide",
                    title: viewId,
                    citations: [],
                    sections: [
                        {
                            id: "diagnose",
                            role: "diagnostic",
                            heading: "Diagnosis",
                            body: "Synthetic evidence.",
                        },
                    ],
                },
                relationships: [],
            };
            head = (await store.saveViewDraft(request)).commitId;
            const viewRoot = path.join(indexRoot, viewHash(viewId));
            for (const directory of [
                ".segments",
                "generation-1",
                "generation-2",
            ]) {
                const folder = path.join(viewRoot, directory);
                await mkdir(folder, { recursive: true });
                await writeFile(
                    path.join(folder, "fixture.json"),
                    JSON.stringify({ viewId, directory }),
                );
            }
        }

        await store.forgetSource("corpus", "forgotten-source");
        expect(await readdir(indexRoot)).toEqual([viewHash("retained")]);
        const retainedRoot = path.join(indexRoot, viewHash("retained"));
        expect((await readdir(retainedRoot)).sort()).toEqual([
            ".segments",
            "generation-1",
            "generation-2",
        ]);
        for (const directory of [".segments", "generation-1", "generation-2"])
            expect(
                JSON.parse(
                    await readFile(
                        path.join(retainedRoot, directory, "fixture.json"),
                        "utf8",
                    ),
                ),
            ).toEqual({ viewId: "retained", directory });

        await store.clearDerivedViews("corpus");
        expect(await readdir(indexRoot)).toEqual([]);
        await expect(
            readdir(path.join(retainedRoot, ".segments")),
        ).rejects.toMatchObject({
            code: "ENOENT",
        });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
