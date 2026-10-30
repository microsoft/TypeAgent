// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import git from "isomorphic-git";
import fs from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { runWithSearchTiming } from "@typeagent/knowpro";
import { ViewHistory, type ViewHistoryFaultPoint } from "../src/viewHistory.js";
import { viewStatePayloadPath } from "../src/viewHistoryPayloads.js";

function initialState() {
    return {
        receipt: { sequence: 0 },
        topics: Array.from({ length: 40 }, (_, index) => ({
            id: `topic-${index}`,
            body: `Synthetic topic ${index}: `.repeat(1024),
        })),
        builds: [
            {
                id: "build-1",
                snapshot: { body: "Synthetic build snapshot. ".repeat(12000) },
            },
        ],
        views: { selected: [{ revision: 1 }] },
    };
}
type State = ReturnType<typeof initialState>;

describe("incremental history payloads", () => {
    let directory: string;
    beforeEach(async () => {
        directory = await mkdtemp(
            path.join(process.cwd(), ".history-payloads-"),
        );
    });
    afterEach(async () => {
        import.meta.jest.restoreAllMocks();
        await rm(directory, { recursive: true, force: true });
    });
    const history = (fault?: ViewHistoryFaultPoint) =>
        new ViewHistory(
            directory,
            initialState,
            async (point) => {
                if (point === fault) throw new Error(`Interrupted ${point}`);
            },
            (state) => state.views,
        );
    const options = () => ({
        fs,
        gitdir: path.join(directory, "view-history.git"),
    });
    async function payloadTree(head: string) {
        const { tree } = await git.readTree({ ...options(), oid: head });
        const entry = tree.find(
            (entry) => entry.path === viewStatePayloadPath,
        )!;
        return (await git.readTree({ ...options(), oid: entry.oid })).tree;
    }

    test("receipt commits reuse payloads after restart without caching mutable identities", async () => {
        const state = initialState();
        const first = await history().commit(null, state, {}, "test", "first");
        const before = await payloadTree(first);
        const snapshot = await history().read();
        expect(snapshot.state).toEqual(state);
        expect(snapshot.stateBytes).toBe(
            Buffer.byteLength(JSON.stringify(state)),
        );
        snapshot.state.receipt.sequence++;
        const originalStringify = JSON.stringify;
        let serializedBytes = 0;
        const stringify = import.meta.jest
            .spyOn(JSON, "stringify")
            .mockImplementation((value, replacer, space) => {
                const text = originalStringify(value, replacer, space);
                if (text) serializedBytes += Buffer.byteLength(text);
                return text;
            });
        const second = await history().commit(
            first,
            snapshot.state,
            {},
            "test",
            "receipt",
        );
        stringify.mockRestore();
        expect(serializedBytes).toBeLessThan(snapshot.stateBytes * 0.1);
        const after = await payloadTree(second);
        const oldOids = new Set(before.map((entry) => entry.oid));
        expect(after.filter((entry) => !oldOids.has(entry.oid))).toHaveLength(
            2,
        );
        expect((await history().read(first)).state).toEqual(state);
        expect((await history().read()).state).toEqual(snapshot.state);
        expect((await history().readEntry<State>("state.json")).value).toEqual(
            snapshot.state,
        );
        snapshot.state.topics[0].body = "Changed in place";
        const third = await history().commit(
            second,
            snapshot.state,
            {},
            "test",
            "mutable payload",
        );
        expect((await history().read(third)).state).toEqual(snapshot.state);
        expect((await history().read(first)).state).toEqual(state);
        expect(await history().historyForRecord("selected")).toHaveLength(3);
        await expect(
            history().commit(first, state, {}, "test", "stale"),
        ).rejects.toThrow("head conflict");
    });

    test("legacy migration and mixed history preserve JSON semantics and exact byte counts", async () => {
        const store = new ViewHistory<Record<string, unknown>>(
            directory,
            () => ({}),
        );
        const small = { receipt: 1, missing: undefined, number: NaN };
        const legacy = await store.commit(null, small, {}, "test", "legacy");
        const shared = { text: "shared immutable text".repeat(20000) };
        const large = {
            ...small,
            topics: initialState().topics,
            array: [undefined, , Infinity, shared, shared],
            ["__proto__"]: { safe: true },
            unicode: '日本語\n\t"\\\ud800',
        };
        const expected = JSON.parse(JSON.stringify(large));
        const next = await store.commit(legacy, large, {}, "test", "migrate");
        const snapshot = await store.read();
        expect(snapshot.state).toEqual(expected);
        expect(snapshot.stateBytes).toBe(
            Buffer.byteLength(JSON.stringify(large)),
        );
        const array = snapshot.state.array as Array<Record<string, unknown>>;
        array[3].text = "local mutation";
        expect(array[4].text).toBe(shared.text);
        expect((await store.read(next)).state).toEqual(expected);
        expect((await store.read(legacy)).state).toEqual({
            receipt: 1,
            number: null,
        });
        const custom = {
            topics: initialState().topics,
            custom: {
                toJSON(key: string) {
                    return { key };
                },
            },
            date: new Date("2026-10-28T00:00:00.000Z"),
        };
        await store.commit(next, custom, {}, "test", "custom JSON fallback");
        expect((await store.read()).state).toEqual(
            JSON.parse(JSON.stringify(custom)),
        );
        expect(await store.history()).toHaveLength(3);
    });

    test("reordered keys and accessor-based JSON records retain legacy serialization semantics", async () => {
        const store = new ViewHistory<Record<string, unknown>>(
            directory,
            () => ({}),
            undefined,
            (state) => ({ selected: state.record }),
        );
        const state = {
            topics: initialState().topics,
            builds: initialState().builds,
            record: { first: 1, second: 2 },
        };
        const first = await store.commit(null, state, {}, "test", "first");
        const reordered = {
            ...state,
            record: { second: 2, first: 1 },
        };
        const second = await store.commit(
            first,
            reordered,
            {},
            "test",
            "reorder",
        );
        expect(JSON.stringify((await store.read()).state)).toBe(
            JSON.stringify(reordered),
        );
        expect(
            JSON.stringify(
                (await store.historyForRecord("selected"))[0].record,
            ),
        ).toBe('{"second":2,"first":1}');
        let calls = 0;
        const accessor = {
            get value() {
                return ++calls;
            },
        };
        await store.commit(
            second,
            { ...state, record: accessor },
            {},
            "test",
            "accessor",
        );
        // State and the independent record entry each serialize once, as in
        // the legacy writer; equality checks must not invoke the getter.
        expect(calls).toBe(2);
        expect((await store.read()).state.record).toEqual({ value: 1 });
        expect((await store.historyForRecord("selected"))[0].record).toEqual({
            value: 2,
        });
    });

    test("an interrupted format migration leaves the legacy ref authoritative", async () => {
        const store = new ViewHistory<Record<string, unknown>>(
            directory,
            () => ({}),
        );
        const legacy = await store.commit(
            null,
            { receipt: 1 },
            {},
            "test",
            "legacy",
        );
        await expect(
            history("ref").commit(
                legacy,
                initialState(),
                {},
                "test",
                "interrupted migration",
            ),
        ).rejects.toThrow("Interrupted ref");
        expect((await store.read()).state).toEqual({ receipt: 1 });
        const migrated = await history().commit(
            legacy,
            initialState(),
            {},
            "test",
            "migrated",
        );
        expect((await store.read(migrated)).state).toEqual(initialState());
        expect((await store.read(legacy)).state).toEqual({ receipt: 1 });
    });

    test.each(["blob", "tree", "commit", "ref"] as const)(
        "interrupted %s never publishes dangling or uncommitted payloads",
        async (fault) => {
            const state = initialState();
            const first = await history().commit(
                null,
                state,
                {},
                "test",
                "first",
            );
            state.topics[0].body = "Unpublished payload ".repeat(20000);
            await expect(
                history(fault).commit(first, state, {}, "test", "interrupted"),
            ).rejects.toThrow(`Interrupted ${fault}`);
            expect(await history().readHead()).toBe(first);
            expect((await history().read()).state).toEqual(initialState());
            const second = await history().commit(
                first,
                state,
                {},
                "test",
                "recover",
            );
            expect((await history().read(second)).state).toEqual(state);
        },
    );

    test.each(["missing", "corrupt"] as const)(
        "%s payloads fail explicitly on reads and attempted reuse",
        async (fault) => {
            const first = await history().commit(
                null,
                initialState(),
                {},
                "test",
                "first",
            );
            const entry = (await payloadTree(first)).find(
                (entry) => entry.path !== "manifest.json",
            )!;
            const file = path.join(
                options().gitdir,
                "objects",
                entry.oid.slice(0, 2),
                entry.oid.slice(2),
            );
            if (fault === "missing") await rm(file);
            else await writeFile(file, "corrupt object");
            await expect(history().read()).rejects.toThrow(
                "View history payload is missing or corrupt",
            );
            await expect(
                history().commit(first, initialState(), {}, "test", "reuse"),
            ).rejects.toThrow("View history payload is missing or corrupt");
            expect(await history().readHead()).toBe(first);
        },
    );

    test.each([
        "unknown-version",
        "missing-manifest",
        "dangling-reference",
    ] as const)(
        "%s cannot silently fall back to a legacy snapshot",
        async (fault) => {
            const first = await history().commit(
                null,
                initialState(),
                {},
                "test",
                "first",
            );
            const root = (await git.readTree({ ...options(), oid: first }))
                .tree;
            const payloads = root.find(
                (entry) => entry.path === viewStatePayloadPath,
            )!;
            let tree = await payloadTree(first);
            if (fault === "missing-manifest")
                tree = tree.filter((entry) => entry.path !== "manifest.json");
            else if (fault === "dangling-reference") {
                const leaf = tree.find(
                    (entry) => entry.path !== "manifest.json",
                )!;
                tree = tree.filter((entry) => entry !== leaf);
            } else {
                const manifest = tree.find(
                    (entry) => entry.path === "manifest.json",
                )!;
                const { blob } = await git.readBlob({
                    ...options(),
                    oid: manifest.oid,
                });
                const value = JSON.parse(Buffer.from(blob).toString("utf8"));
                value.version = 100;
                manifest.oid = await git.writeBlob({
                    ...options(),
                    blob: Buffer.from(JSON.stringify(value)),
                });
            }
            payloads.oid = await git.writeTree({ ...options(), tree });
            root.push({
                mode: "100644",
                path: "state.json",
                type: "blob",
                oid: await git.writeBlob({
                    ...options(),
                    blob: Buffer.from("{}"),
                }),
            });
            const commit = (await git.readCommit({ ...options(), oid: first }))
                .commit;
            const broken = await git.writeCommit({
                ...options(),
                commit: {
                    ...commit,
                    tree: await git.writeTree({ ...options(), tree: root }),
                    parent: [first],
                },
            });
            await git.writeRef({
                ...options(),
                ref: "refs/heads/typeagent-history",
                value: broken,
                force: true,
            });
            await expect(history().read()).rejects.toThrow(
                "View history payload is missing or corrupt",
            );
        },
    );

    test("generic view entry names and JSON behavior remain compatible", async () => {
        const store = history();
        const state = initialState();
        const first = await store.commit(
            null,
            state,
            { "state-payloads": '{"ordinary":"entry"}' },
            "test",
            "legacy named entry",
        );
        expect((await store.read()).state).toEqual(state);
        expect((await store.readEntry("state-payloads")).value).toEqual({
            ordinary: "entry",
        });
        await store.commit(
            first,
            state,
            { "state.json": '{"overridden":true}' },
            "test",
            "legacy state override",
        );
        expect((await store.read()).state).toEqual({ overridden: true });
    });

    test("timings report actual serialization separately from reused logical bytes", async () => {
        const trace = process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
        const output = import.meta.jest
            .spyOn(console, "warn")
            .mockImplementation();
        process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = "1";
        try {
            const state = initialState();
            const first = await history().commit(
                null,
                state,
                {},
                "test",
                "first",
            );
            state.receipt.sequence++;
            await runWithSearchTiming("test-trace", "history-test", () =>
                history().commit(first, state, {}, "test", "receipt"),
            );
            const events = output.mock.calls.map(([text]) =>
                JSON.parse(
                    String(text).slice("[memory-search-timing] ".length),
                ),
            );
            const payload = events.find(
                (event) => event.stage === "view.history.payload.write",
            );
            expect(payload.metadata.serializedBytes).toBeLessThan(
                payload.metadata.stateBytes * 0.1,
            );
            expect(payload.metadata.reusedPayloadBytes).toBeGreaterThan(
                payload.metadata.stateBytes * 0.9,
            );
            expect(events.map((event) => event.stage)).toContain(
                "view.history.commit",
            );
            expect(JSON.stringify(events)).not.toContain("Synthetic topic");
        } finally {
            if (trace === undefined)
                delete process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
            else process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = trace;
            output.mockRestore();
        }
    });

    test.each(["purge-prepared", "purge-swapped", "purge-cleaned"] as const)(
        "%s recovery removes retained and orphaned sensitive payloads",
        async (fault) => {
            const secret = "private-payload-for-forgetting";
            const orphan = "private-orphan-for-forgetting";
            const state = initialState();
            state.topics[0].body = secret.repeat(20000);
            const first = await history().commit(
                null,
                state,
                {},
                "test",
                "secret",
            );
            state.topics[0].body = orphan.repeat(20000);
            await expect(
                history("ref").commit(first, state, {}, "test", "orphan"),
            ).rejects.toThrow("Interrupted ref");
            const sanitize = (current: State) => ({
                ...current,
                topics: [],
                builds: [],
            });
            await expect(
                history(fault).purge("source", sanitize, () => ({})),
            ).rejects.toThrow(`Interrupted ${fault}`);
            await expect(history().read()).rejects.toThrow("quarantined");
            await history().recoverPurge(sanitize, () => ({}));
            expect((await history().read()).state).toEqual(
                sanitize({ ...initialState(), topics: state.topics }),
            );
            expect(await readdir(directory)).toEqual(["view-history.git"]);
            await expect(history().read(first)).rejects.toThrow();
            const objects = path.join(options().gitdir, "objects");
            for (const prefix of await readdir(objects)) {
                if (!/^[a-f0-9]{2}$/.test(prefix)) continue;
                for (const name of await readdir(path.join(objects, prefix))) {
                    const text = inflateSync(
                        await readFile(path.join(objects, prefix, name)),
                    ).toString("utf8");
                    expect(text).not.toContain(secret);
                    expect(text).not.toContain(orphan);
                }
            }
        },
    );
});
