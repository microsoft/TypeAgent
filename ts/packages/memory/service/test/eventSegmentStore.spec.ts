// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import {
    mkdtemp,
    readFile,
    readdir,
    rm,
    stat,
    writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    EventSegmentStore,
    type EventStorageFaultPoint,
} from "../src/eventSegmentStore.js";
import type { MemoryEvent } from "../src/types.js";

describe("segmented canonical event storage", () => {
    let root: string;
    let file: string;
    let failure: EventStorageFaultPoint | undefined;
    const event = (id: string, content = `Content ${id}`): MemoryEvent => ({
        eventId: id,
        corpusId: "corpus",
        idempotencyKey: id,
        producer: { producerId: "fixture", producerType: "test" },
        eventType: "turn.completed",
        sourceKind: "conversation",
        content,
        observedAt: "2026-10-19T00:00:00Z",
        eventTime: "2026-10-19T00:00:00Z",
        createdAt: "2026-10-19T00:00:00Z",
    });
    const open = () =>
        new EventSegmentStore<{ key: string }>(
            file,
            async () => {
                await rm(path.join(root, "derived-private.json"), {
                    force: true,
                });
            },
            async (point) => {
                if (point === failure)
                    throw new Error(`Expected ${point} interruption`);
            },
        );
    beforeEach(async () => {
        root = await mkdtemp(path.join(os.tmpdir(), "event-segments-"));
        file = path.join(root, "events.jsonl");
        failure = undefined;
    });
    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });
    const segment = async (id: string) => {
        const identity = createHash("sha256").update(id).digest("hex");
        return path.join(
            root,
            "event-segments",
            (await readdir(path.join(root, "event-segments"))).find((name) =>
                name.includes(identity),
            )!,
        );
    };

    test("append writes one new immutable event and a bounded pointer, not retained payloads or lookup maps", async () => {
        const store = open();
        for (let i = 0; i < 100; i++)
            await store.append(event(`event-${i}`, "Retained ".repeat(1000)));
        const prior = await stat(await segment("event-0"));
        const before = await readdir(path.join(root, "event-segments"));
        await store.append(event("new", "Changed content"));
        expect(
            (await readdir(path.join(root, "event-segments"))).length -
                before.length,
        ).toBe(1);
        expect((await stat(file)).size).toBeLessThan(160);
        const retained = await stat(await segment("event-0"));
        expect(retained.ino).toBe(prior.ino);
        expect(retained.mtimeMs).toBe(prior.mtimeMs);
        expect((await open().get("new"))?.content).toBe("Changed content");
    });

    test("cold selective lookup does not read or decode unrelated event payloads", async () => {
        const store = open();
        await store.append(event("wanted"));
        await store.append(
            event("unrelated", "Very large retained content ".repeat(2000)),
        );
        await writeFile(await segment("unrelated"), "Corrupt unrelated body");
        expect(await open().get("wanted")).toEqual(event("wanted"));
        await expect(open().records()).rejects.toThrow("Corrupt");
    });

    test("loaded reads and recovery finish against committed events while append is held", async () => {
        let resume!: () => void;
        let entered!: () => void;
        const held = new Promise<void>((resolve) => {
            resume = resolve;
        });
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        let block = false;
        const store = new EventSegmentStore<{ key: string }>(
            file,
            async () => {},
            async (point) => {
                if (block && point === "descriptor-prepared") {
                    entered();
                    await held;
                }
            },
        );
        await store.append(event("first"));
        block = true;
        const append = store.append(event("second"));
        await started;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const result = await Promise.race([
                Promise.all([
                    store.get("first"),
                    store.records(),
                    store.version(),
                    store.suppressions(),
                    store.recover(),
                    store.get("second"),
                ]),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(
                        () =>
                            reject(new Error("Event reads waited for append")),
                        1000,
                    );
                }),
            ]);
            expect(result[0]).toEqual(event("first"));
            expect(result[1].events).toEqual([event("first")]);
            expect(result[2].sequence).toBe(1);
            expect(result[3]).toEqual([]);
            expect(result[5]).toBeUndefined();
        } finally {
            clearTimeout(timer);
            resume();
            await append;
        }
        expect((await store.records()).events).toEqual([
            event("first"),
            event("second"),
        ]);
    });

    test("deletion changes eligibility without rewinding sequence and cannot restore a forgotten identity", async () => {
        const store = open();
        await store.append(event("first"));
        await store.append(event("second"));
        await store.replace([event("second")], [{ key: "first-suppressed" }]);
        expect(await store.version()).toEqual({
            sequence: 2,
            eligibilityRevision: 1,
        });
        await store.append(event("third"));
        expect(await store.version()).toEqual({
            sequence: 3,
            eligibilityRevision: 1,
        });
        expect(await open().get("first")).toBeUndefined();
        expect(
            (await open().records()).events.map((value) => value.eventId),
        ).toEqual(["second", "third"]);
        await expect(store.append(event("first"))).rejects.toThrow("Duplicate");
    });

    test.each(["segment-written", "descriptor-prepared"] as const)(
        "%s append interruption preserves the committed prefix",
        async (point) => {
            const store = open();
            await store.append(event("first"));
            const before = await readFile(file, "utf8");
            failure = point;
            await expect(
                store.append(event("second", "Uncommitted private payload")),
            ).rejects.toThrow("Expected");
            expect(await readFile(file, "utf8")).toBe(before);
            failure = undefined;
            expect((await open().records()).events).toEqual([event("first")]);
            expect(
                await readdir(path.join(root, "event-segments")),
            ).toHaveLength(1);
        },
    );

    test.each(["purge-started", "purge-finished"] as const)(
        "%s interruption withholds reads and resumes physical purge",
        async (point) => {
            const store = open();
            await store.append(event("private", "Forgotten private payload"));
            await store.append(event("public", "Retained public payload"));
            await writeFile(
                path.join(root, "derived-private.json"),
                "Forgotten private payload",
            );
            failure = point;
            await expect(
                store.replace(
                    [event("public", "Retained public payload")],
                    [{ key: "private-suppressed" }],
                ),
            ).rejects.toThrow("Expected");
            await expect(store.get("private")).rejects.toThrow("Expected");
            failure = undefined;
            const recovered = open();
            await recovered.recover();
            expect(await recovered.get("private")).toBeUndefined();
            expect(await recovered.get("public")).toEqual(
                event("public", "Retained public payload"),
            );
            expect(
                JSON.parse(await readFile(file, "utf8")).pendingPurge,
            ).toBeUndefined();
            for (const name of await readdir(path.join(root, "event-segments")))
                expect(
                    await readFile(
                        path.join(root, "event-segments", name),
                        "utf8",
                    ),
                ).not.toContain("Forgotten private payload");
            await expect(
                stat(path.join(root, "derived-private.json")),
            ).rejects.toMatchObject({ code: "ENOENT" });
        },
    );

    test("missing committed segments and unsupported canonical formats fail without resetting data", async () => {
        const store = open();
        await store.append(event("first"));
        await rm(await segment("first"));
        await expect(open().get("first")).rejects.toThrow("Missing committed");
        const incompatible = '{"eventStorageVersion":99,"preserve":"original"}';
        await writeFile(file, incompatible);
        await expect(open().recover()).rejects.toThrow("reset/reimport");
        expect(await readFile(file, "utf8")).toBe(incompatible);
    });
});
