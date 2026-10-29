// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TypedViewStore } from "../src/viewStore.js";
import { ViewHistory } from "../src/viewHistory.js";
import type { ViewBuildSnapshot } from "../src/viewTypes.js";

test("assessment and family receipts publish together or not at all", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "assessment-atomic-"));
    try {
        const store = new TypedViewStore(root, "test");
        const definition = {
            viewId: "candidate",
            kind: "wiki" as const,
            selector: { kind: "sources" as const, sources: [] },
        };
        const input: ViewBuildSnapshot = {
            corpusId: "corpus",
            actor: "test",
            expectedVersion: 0,
            definition,
            inputs: [],
            pipeline: "informational-wiki-v1",
            model: "offline",
            fingerprint: "test",
            bounds: {},
        };
        const { job } = await store.admitViewBuild(
            {
                corpusId: "corpus",
                expectedHead: null,
                targets: [{ definition, expectedVersion: 0 }],
            },
            [input],
            undefined,
            {
                enabled: true,
                dirty: true,
                cursor: 0,
                descriptors: [
                    { viewId: "candidate", query: "candidate", sourceIds: [] },
                ],
            },
        );
        const history = new ViewHistory(
            path.join(root, "corpus", "views"),
            () => ({}),
        );
        const before = (await history.history()).length;
        await store.updateViewBuild(
            "corpus",
            job.jobId,
            (current) => {
                current.results[0].state = "skipped";
            },
            (family) => {
                family.descriptors[0].admission = {
                    generation: undefined,
                    policy: "policy",
                    reason: "deferred",
                    assessmentKey: "dependency-key",
                };
            },
        );
        expect((await history.history()).length - before).toBe(1);
        expect(
            (await store.getViewBuild("corpus", job.jobId))!.results[0].state,
        ).toBe("skipped");
        expect(
            (await store.getWikiFamily("corpus")).descriptors[0].admission
                ?.assessmentKey,
        ).toBe("dependency-key");
        const head = await history.readHead();
        await expect(
            store.updateViewBuild(
                "corpus",
                job.jobId,
                (current) => {
                    current.results[0].state = "blocked";
                },
                () => {
                    throw new Error("family update failed");
                },
            ),
        ).rejects.toThrow("family update failed");
        expect(await history.readHead()).toBe(head);
        expect(
            (await store.getViewBuild("corpus", job.jobId))!.results[0].state,
        ).toBe("skipped");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
