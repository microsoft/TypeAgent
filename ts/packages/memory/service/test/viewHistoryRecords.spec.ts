// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import git from "isomorphic-git";
import fs from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { ViewHistory } from "../src/viewHistory.js";
import { TypedViewStore } from "../src/viewStore.js";
import {
    checkHistoryRecords,
    initialState,
    legacyEntries,
    parsingCounts,
    version,
    type State,
} from "./viewHistoryRecordsTestCommon.js";

describe("full-fidelity per-View history records", () => {
    let root: string;
    let directory: string;
    beforeEach(async () => {
        root = await mkdtemp(path.join(process.cwd(), ".b12-view-records-"));
        directory = path.join(root, "corpus", "views");
    });
    afterEach(async () => {
        import.meta.jest.restoreAllMocks();
        await rm(root, { recursive: true, force: true });
    });

    function history(indexed = true) {
        return new ViewHistory<State>(
            directory,
            initialState,
            undefined,
            indexed ? (state) => state.views : undefined,
        );
    }

    test("10 commits match legacy ordering and exact records without parsing unrelated state", async () => {
        await checkHistoryRecords(root, 10);
    });

    test("legacy indexes rebuild once, survive restart, and recover missing or malformed indexes", async () => {
        const legacy = history(false);
        const state = initialState();
        let head: string | null = null;
        for (let index = 0; index < 3; index++) {
            state.corpusSequence = index;
            if (index) state.views.target.push(version("target", index + 1));
            head = await legacy.commit(
                head,
                state,
                {},
                "test",
                `Legacy ${index}`,
            );
        }
        const expected = legacyEntries(await legacy.history());
        const parse = import.meta.jest.spyOn(JSON, "parse");
        const store = new TypedViewStore(root);
        const concurrent = await Promise.all([
            store.getViewHistory({ corpusId: "corpus", viewId: "target" }),
            new TypedViewStore(root).getViewHistory({
                corpusId: "corpus",
                viewId: "target",
            }),
        ]);
        expect(concurrent).toEqual([expected, expected]);
        expect(parsingCounts(parse.mock.calls).corpus).toBe(3);
        const indexDirectory = path.join(
            directory,
            "view-history.git",
            "view-record-index",
        );
        expect(await readdir(indexDirectory)).toHaveLength(3);
        parse.mockClear();
        expect(
            await new TypedViewStore(root).getViewHistory({
                corpusId: "corpus",
                viewId: "target",
            }),
        ).toEqual(expected);
        expect(parsingCounts(parse.mock.calls).corpus).toBe(0);
        await writeFile(path.join(indexDirectory, head!), "interrupted-index");
        parse.mockClear();
        expect(
            await store.getViewHistory({
                corpusId: "corpus",
                viewId: "target",
            }),
        ).toEqual(expected);
        expect(parsingCounts(parse.mock.calls).corpus).toBe(1);
        await writeFile(path.join(indexDirectory, head!), "a".repeat(40));
        parse.mockClear();
        expect(
            await store.getViewHistory({
                corpusId: "corpus",
                viewId: "target",
            }),
        ).toEqual(expected);
        expect(parsingCounts(parse.mock.calls).corpus).toBe(1);
        await rm(indexDirectory, { recursive: true });
        parse.mockClear();
        expect(
            await store.getViewHistory({
                corpusId: "corpus",
                viewId: "target",
            }),
        ).toEqual(expected);
        expect(parsingCounts(parse.mock.calls).corpus).toBe(3);
        parse.mockRestore();

        state.corpusSequence++;
        await history().commit(head, state, {}, "test", "Indexed successor");
        const parsed = import.meta.jest.spyOn(JSON, "parse");
        expect(
            await store.getViewHistory({
                corpusId: "corpus",
                viewId: "target",
            }),
        ).toEqual(expected);
        expect(parsingCounts(parsed.mock.calls).corpus).toBe(0);
    });

    test("head changes during indexed reads and scoped snapshots fail exact guards", async () => {
        const indexed = history();
        const state = initialState();
        const head = await indexed.commit(null, state, {}, "test", "First");
        const original = git.readBlob;
        let changed = false;
        import.meta.jest
            .spyOn(git, "readBlob")
            .mockImplementation(async (options) => {
                const blob = await original(options);
                if (!changed) {
                    changed = true;
                    state.corpusSequence++;
                    await indexed.commit(
                        head,
                        state,
                        {},
                        "test",
                        "Concurrent mutation",
                    );
                }
                return blob;
            });
        const store = new TypedViewStore(root);
        await expect(
            store.getViewHistory({ corpusId: "corpus", viewId: "target" }),
        ).rejects.toThrow("View history changed during read operation");
        import.meta.jest.restoreAllMocks();
        await expect(
            store.withReadSnapshot("corpus", async () => {
                const current = await indexed.read();
                state.corpusSequence++;
                await indexed.commit(
                    current.head,
                    state,
                    {},
                    "test",
                    "Scoped mutation",
                );
                return store.getViewHistory({
                    corpusId: "corpus",
                    viewId: "target",
                });
            }),
        ).rejects.toThrow("View history changed during read operation");
        await expect(
            indexed.commit(head, state, {}, "test", "Stale writer"),
        ).rejects.toThrow("View history head conflict");
    });

    test("unpublished record blobs never become a history commit", async () => {
        const state = initialState();
        const indexed = history();
        const head = await indexed.commit(null, state, {}, "test", "Committed");
        const interrupted = new ViewHistory<State>(
            directory,
            initialState,
            async (point) => {
                if (point === "ref") throw new Error("Interrupted publication");
            },
            (state) => state.views,
        );
        state.views.target.push(version("target", 2));
        await expect(
            interrupted.commit(head, state, {}, "test", "Uncommitted"),
        ).rejects.toThrow("Interrupted publication");
        const entries = await new TypedViewStore(root).getViewHistory({
            corpusId: "corpus",
            viewId: "target",
        });
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
            commitId: head,
            version: { revisionId: "target-1" },
        });
    });

    test.each(["purge-prepared", "purge-swapped", "purge-cleaned"] as const)(
        "interrupted %s quarantines records until recovery removes old indexes and objects",
        async (fault) => {
            const state = initialState();
            const oldHead = await history(false).commit(
                null,
                state,
                {},
                "test",
                "Sensitive legacy state",
            );
            const store = new TypedViewStore(root);
            await store.getViewHistory({
                corpusId: "corpus",
                viewId: "target",
            });
            let failed = false;
            const interrupted = new ViewHistory<State>(
                directory,
                initialState,
                async (point) => {
                    if (point === fault && !failed) {
                        failed = true;
                        throw new Error("Interrupted privacy purge");
                    }
                },
                (state) => state.views,
            );
            const sanitize = (state: State) => {
                delete state.views.target;
                return state;
            };
            const render = () => ({});
            await expect(
                interrupted.purge("target-source", sanitize, render),
            ).rejects.toThrow("Interrupted privacy purge");
            await expect(
                store.getViewHistory({
                    corpusId: "corpus",
                    viewId: "target",
                }),
            ).rejects.toThrow("quarantined pending privacy purge");
            await interrupted.recoverPurge(sanitize, render);
            expect(
                await store.getViewHistory({
                    corpusId: "corpus",
                    viewId: "target",
                }),
            ).toEqual([]);
            expect(
                await store.getViewHistory({
                    corpusId: "corpus",
                    viewId: "unrelated",
                }),
            ).toHaveLength(1);
            expect(await readdir(directory)).toEqual(["view-history.git"]);
            const gitdir = path.join(directory, "view-history.git");
            expect(await readdir(gitdir)).not.toContain("view-record-index");
            await expect(
                git.readCommit({
                    fs,
                    gitdir,
                    oid: oldHead,
                }),
            ).rejects.toThrow();
        },
    );

    test.each(["source", "event", "clear"] as const)(
        "%s forgetting removes legacy indexes, retained record blobs, and old generations",
        async (kind) => {
            const state = initialState();
            const secret = "private-historical-editorial-text";
            state.views.target[0].edits![0].newValue = secret;
            if (kind === "event")
                state.views.target[0].content.citations.push({
                    sourceId: "event-source",
                    revisionId: "event-revision",
                    locator: "chars:0-7",
                    excerpt: "private",
                    evidence: { kind: "event", eventId: "private-event" },
                });
            const legacy = history(false);
            const first = await legacy.commit(
                null,
                state,
                {},
                "test",
                "Legacy sensitive state",
            );
            const store = new TypedViewStore(root);
            await store.getViewHistory({
                corpusId: "corpus",
                viewId: "target",
            });
            state.corpusSequence++;
            const indexedHead = await history().commit(
                first,
                state,
                {},
                "test",
                "Indexed sensitive state",
            );
            if (kind === "source")
                await store.forgetSource("corpus", "target-source");
            else if (kind === "event")
                await store.forgetEvent("corpus", "private-event");
            else await store.clearDerivedViews("corpus");
            expect(
                await new TypedViewStore(root).getViewHistory({
                    corpusId: "corpus",
                    viewId: "target",
                }),
            ).toEqual([]);
            const retained = await store.getViewHistory({
                corpusId: "corpus",
                viewId: "unrelated",
            });
            expect(retained).toHaveLength(kind === "clear" ? 0 : 1);
            expect(await readdir(directory)).toEqual(["view-history.git"]);
            const gitdir = path.join(directory, "view-history.git");
            expect(await readdir(gitdir)).not.toContain("view-record-index");
            await expect(
                git.readCommit({ fs, gitdir, oid: indexedHead }),
            ).rejects.toThrow();
            const objects = path.join(gitdir, "objects");
            for (const prefix of await readdir(objects, {
                withFileTypes: true,
            })) {
                if (!prefix.isDirectory() || !/^[a-f0-9]{2}$/.test(prefix.name))
                    continue;
                for (const file of await readdir(
                    path.join(objects, prefix.name),
                )) {
                    const text = inflateSync(
                        await readFile(path.join(objects, prefix.name, file)),
                    ).toString("utf8");
                    expect(text).not.toContain(secret);
                    expect(text).not.toContain("target-source");
                    expect(text).not.toContain("private-event");
                }
            }
        },
    );
});
