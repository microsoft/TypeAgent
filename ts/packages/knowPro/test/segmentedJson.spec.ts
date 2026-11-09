// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    mkdtemp,
    mkdir,
    readFile,
    readdir,
    rm,
    stat,
    writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
    collectJsonSegments,
    isSegmentedJson,
    readSegmentedJson,
    writeSegmentedJson,
} from "../src/segmentedJson.js";
import { runWithSearchTiming } from "../src/searchTiming.js";

describe("immutable segmented JSON publication", () => {
    let root: string;
    let file: string;
    const records = () =>
        Array.from({ length: 1024 }, (_, ordinal) => ({
            ordinal,
            text: `${"Retained source knowledge. ".repeat(24)}${ordinal}`,
        }));
    beforeEach(async () => {
        root = await mkdtemp(path.join(os.tmpdir(), "knowpro-segments-"));
        file = path.join(root, "generation", "corpus_data.json");
    });
    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });
    const descriptor = async (target: string) => {
        const value: unknown = JSON.parse(await readFile(target, "utf8"));
        if (!isSegmentedJson(value))
            throw new Error("Missing segment descriptor");
        return value;
    };

    test("append writes only changed nodes and retained values, vectors and ordinals roundtrip exactly", async () => {
        const data = {
            records: records(),
            vectors: [[0.6, 0.8]],
            optional: undefined,
        };
        await writeSegmentedJson(file, data, { messages: 1024 });
        const blobs = path.join(root, ".segments");
        const original = new Map(
            await Promise.all(
                (await readdir(blobs)).map(
                    async (name) =>
                        [name, await stat(path.join(blobs, name))] as const,
                ),
            ),
        );
        const next = path.join(root, "next-generation", "corpus_data.json");
        data.records.push({ ordinal: 1024, text: "Only this source is new" });
        await writeSegmentedJson(next, data, { messages: 1025 });
        let changedBytes = 0;
        for (const name of await readdir(blobs)) {
            const info = await stat(path.join(blobs, name));
            if (original.has(name)) {
                expect(info.ino).toBe(original.get(name)!.ino);
                expect(info.mtimeMs).toBe(original.get(name)!.mtimeMs);
            } else changedBytes += info.size;
        }
        expect(changedBytes).toBeLessThan(80 * 1024);
        expect(changedBytes).toBeLessThan(
            Buffer.byteLength(JSON.stringify(data)) / 4,
        );
        expect((await readdir(blobs)).length).toBeLessThan(40);
        expect(await readSegmentedJson(next, await descriptor(next))).toEqual(
            JSON.parse(JSON.stringify(data)),
        );
        expect(
            (
                (await readSegmentedJson(file, await descriptor(file))) as {
                    records: unknown[];
                }
            ).records,
        ).toHaveLength(1024);
        await collectJsonSegments(root);
        expect(await readSegmentedJson(next, await descriptor(next))).toEqual(
            JSON.parse(JSON.stringify(data)),
        );
    });

    test("binary publication and collection preserve safe ingestion profiling", async () => {
        const originalFlag = process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
        const originalWarn = console.warn;
        const logs: string[] = [];
        process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = "1";
        console.warn = (line: unknown) => logs.push(String(line));
        const data = {
            text: "Private source content must never appear in timing logs",
            vectors: [new Float32Array([0.6, 0.8])],
        };
        try {
            await runWithSearchTiming(
                "segment-profile",
                "ingestion",
                async () => {
                    await writeSegmentedJson(file, data, {});
                    expect(
                        await readSegmentedJson(file, await descriptor(file)),
                    ).toEqual(data);
                    await collectJsonSegments(root);
                },
            );
            const entries: Array<{
                stage: string;
                traceId: string;
                status: string;
            }> = logs.map((line) =>
                JSON.parse(line.replace("[memory-search-timing] ", "")),
            );
            expect(entries.map((entry) => entry.stage)).toEqual(
                expect.arrayContaining([
                    "storage.io.segment.open",
                    "storage.io.segment.write",
                    "storage.io.segment.sync",
                    "storage.io.segment.close",
                    "storage.io.segment.read",
                    "storage.segment.hash",
                    "storage.segment.json.serialize",
                    "storage.segment.json.parse",
                    "storage.segment.queue.wait",
                    "storage.segment.queue.work",
                ]),
            );
            expect(
                entries.every((entry) => entry.traceId === "segment-profile"),
            ).toBe(true);
            expect(
                entries
                    .filter((entry) =>
                        [
                            "storage.io.segment.write",
                            "storage.io.segment.sync",
                            "storage.io.segment.close",
                        ].includes(entry.stage),
                    )
                    .every((entry) => entry.status === "success"),
            ).toBe(true);
            expect(logs.join("\n")).not.toContain(data.text);
        } finally {
            if (originalFlag === undefined)
                delete process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
            else process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = originalFlag;
            console.warn = originalWarn;
        }
    });

    test.each(["segment-written", "descriptor-prepared"] as const)(
        "a %s failure retains the previous publication and orphan collection is recoverable",
        async (point) => {
            const initial = { records: records() };
            await writeSegmentedJson(file, initial, {});
            const before = await readFile(file, "utf8");
            await expect(
                writeSegmentedJson(
                    file,
                    {
                        records: [
                            ...initial.records,
                            { text: "Uncommitted private payload" },
                        ],
                    },
                    {},
                    async (actual) => {
                        if (actual === point)
                            throw new Error("Expected interruption");
                    },
                ),
            ).rejects.toThrow("Expected interruption");
            expect(await readFile(file, "utf8")).toBe(before);
            await collectJsonSegments(root);
            expect(
                await readSegmentedJson(file, await descriptor(file)),
            ).toEqual(initial);
            for (const name of await readdir(path.join(root, ".segments")))
                expect(
                    await readFile(path.join(root, ".segments", name), "utf8"),
                ).not.toContain("Uncommitted private payload");
        },
    );

    test("collection removes forgotten bytes only after obsolete generation descriptors disappear", async () => {
        await writeSegmentedJson(
            file,
            { text: "Private forgotten payload" },
            {},
        );
        const next = path.join(root, "next", "corpus_data.json");
        await writeSegmentedJson(next, { text: "Retained public payload" }, {});
        await collectJsonSegments(root);
        expect(await readSegmentedJson(file, await descriptor(file))).toEqual({
            text: "Private forgotten payload",
        });
        await rm(path.dirname(file), { recursive: true });
        await collectJsonSegments(root);
        const bytes = await Promise.all(
            (await readdir(path.join(root, ".segments"))).map((name) =>
                readFile(path.join(root, ".segments", name), "utf8"),
            ),
        );
        expect(bytes.join("\n")).not.toContain("Private forgotten payload");
        expect(await readSegmentedJson(next, await descriptor(next))).toEqual({
            text: "Retained public payload",
        });
    });

    test("referenced corruption and unsupported or unsafe descriptors fail explicitly", async () => {
        await writeSegmentedJson(file, { text: "Verified" }, {});
        const value = await descriptor(file);
        await writeFile(
            path.join(root, ".segments", `${value.root}.json`),
            "{}",
        );
        await expect(readSegmentedJson(file, value)).rejects.toThrow("Corrupt");
        expect(() =>
            isSegmentedJson({ ...value, segmentedJsonVersion: 3 }),
        ).toThrow("unsupported");
        expect(() =>
            isSegmentedJson({ ...value, root: "..\\outside" }),
        ).toThrow("unsupported");
    });

    test("concurrent publication and collection keep every published root readable", async () => {
        const next = path.join(root, "next", "corpus_data.json");
        await mkdir(path.dirname(next), { recursive: true });
        await Promise.all([
            writeSegmentedJson(file, { records: records() }, {}),
            writeSegmentedJson(next, { records: records().slice(0, 512) }, {}),
            collectJsonSegments(root),
        ]);
        expect(await readSegmentedJson(file, await descriptor(file))).toEqual({
            records: records(),
        });
        expect(await readSegmentedJson(next, await descriptor(next))).toEqual({
            records: records().slice(0, 512),
        });
    });

    test("legacy v1 roots remain readable and survive collection beside v2 publications", async () => {
        const blobs = path.join(root, ".segments");
        await mkdir(blobs, { recursive: true });
        const bytes = Buffer.from(
            JSON.stringify({
                kind: "value",
                value: { vectors: [[0.6, 0.8]] },
            }) + "\n",
        );
        const hash = createHash("sha256").update(bytes).digest("hex");
        await writeFile(path.join(blobs, `${hash}.json`), bytes);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(
            file,
            JSON.stringify({
                segmentedJsonVersion: 1,
                root: hash,
                metadata: {},
            }),
        );
        const next = path.join(root, "next", "corpus_data.json");
        await writeSegmentedJson(
            next,
            { vectors: [new Float32Array([1, 0])] },
            {},
        );
        const staging = path.join(
            blobs,
            `${"a".repeat(64)}.bin.00000000-0000-0000-0000-000000000000.staging`,
        );
        await writeFile(staging, "Interrupted binary write");
        await collectJsonSegments(root);
        expect(await readSegmentedJson(file, await descriptor(file))).toEqual({
            vectors: [[0.6, 0.8]],
        });
        expect(await readSegmentedJson(next, await descriptor(next))).toEqual({
            vectors: [new Float32Array([1, 0])],
        });
        expect(await readdir(blobs)).not.toContain(path.basename(staging));
    });

    test("collection preserves wide legacy graphs with shared children beside binary publications", async () => {
        const blobs = path.join(root, ".segments");
        await mkdir(blobs, { recursive: true });
        const node = async (value: unknown) => {
            const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
            const hash = createHash("sha256").update(bytes).digest("hex");
            await writeFile(path.join(blobs, `${hash}.json`), bytes);
            return hash;
        };
        const values = Array.from({ length: 33 }, (_, ordinal) => ({
            ordinal,
            text: `Retained legacy record ${ordinal}`,
        }));
        const children = await Promise.all(
            values.map((value) => node({ kind: "value", value })),
        );
        const items = await node({ kind: "items", children });
        const hash = await node({
            kind: "object",
            entries: [
                ["records", items],
                ["first", children[0]],
                ["duplicate", items],
            ],
        });
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(
            file,
            JSON.stringify({
                segmentedJsonVersion: 1,
                root: hash,
                metadata: {},
            }),
        );
        const orphan = await node({
            kind: "value",
            value: "Forgotten legacy payload",
        });
        const next = path.join(root, "next", "corpus_data.json");
        const vectors = { vectors: [new Float32Array([1, 0])] };
        await writeSegmentedJson(next, vectors, {});
        await collectJsonSegments(root);
        expect(await readSegmentedJson(file, await descriptor(file))).toEqual({
            records: values,
            first: values[0],
            duplicate: values,
        });
        expect(await readSegmentedJson(next, await descriptor(next))).toEqual(
            vectors,
        );
        await expect(
            readFile(path.join(blobs, `${orphan}.json`)),
        ).rejects.toMatchObject({
            code: "ENOENT",
        });
    });

    test("date metadata preserves JSON serialization without normalizing the whole generation", async () => {
        const data = { createdAt: new Date("2026-10-21T00:00:00Z") };
        await writeSegmentedJson(file, data, {});
        expect(await readSegmentedJson(file, await descriptor(file))).toEqual(
            JSON.parse(JSON.stringify(data)),
        );
    });

    test("binary vectors use coarse immutable blocks and reuse complete prefixes", async () => {
        const vectors = Array.from({ length: 360 }, (_, ordinal) =>
            Float32Array.from(
                { length: 1536 },
                (_, lane) => (ordinal + lane) / 1000,
            ),
        );
        await writeSegmentedJson(file, { vectors }, {});
        const blobs = path.join(root, ".segments");
        const binary = (await readdir(blobs)).filter((name) =>
            name.endsWith(".bin"),
        );
        expect(binary).toHaveLength(3);
        const before = new Map(
            await Promise.all(
                binary.map(
                    async (name) =>
                        [name, await stat(path.join(blobs, name))] as const,
                ),
            ),
        );
        const next = path.join(root, "next", "corpus_data.json");
        await writeSegmentedJson(
            next,
            {
                vectors: [...vectors, new Float32Array(1536).fill(0.5)],
            },
            {},
        );
        expect(
            (await readdir(blobs)).filter((name) => name.endsWith(".bin")),
        ).toHaveLength(4);
        for (const [name, previous] of before) {
            const current = await stat(path.join(blobs, name));
            expect(current.ino).toBe(previous.ino);
            expect(current.mtimeMs).toBe(previous.mtimeMs);
        }
        expect(await readSegmentedJson(file, await descriptor(file))).toEqual({
            vectors,
        });
        const loaded = (await readSegmentedJson(next, await descriptor(next), {
            reuseVerified: true,
        })) as { vectors: Float32Array[] };
        loaded.vectors[0][0] = 123;
        expect(
            (
                (await readSegmentedJson(file, await descriptor(file), {
                    reuseVerified: true,
                })) as {
                    vectors: Float32Array[];
                }
            ).vectors[0][0],
        ).toBe(vectors[0][0]);
    });

    test("collection reads authenticated reachability without consuming retained vector payloads", async () => {
        await writeSegmentedJson(
            file,
            { vectors: [new Float32Array([1, 0])] },
            {},
        );
        const blobs = path.join(root, ".segments");
        const binary = (await readdir(blobs)).find((name) =>
            name.endsWith(".bin"),
        )!;
        await writeFile(path.join(blobs, binary), Buffer.alloc(8));
        await expect(collectJsonSegments(root)).resolves.toBeUndefined();
        await expect(
            readSegmentedJson(file, await descriptor(file)),
        ).rejects.toThrow("Corrupt");
    });

    test("forget collects private binary backing while preserving shared retained vectors", async () => {
        await writeSegmentedJson(
            file,
            { vectors: [new Float32Array([1, 0])] },
            {},
        );
        const blobs = path.join(root, ".segments");
        const privateBlock = (await readdir(blobs)).find((name) =>
            name.endsWith(".bin"),
        )!;
        const next = path.join(root, "next", "corpus_data.json");
        const retained = { vectors: [new Float32Array([0, 1])] };
        await writeSegmentedJson(next, retained, {});
        const shared = path.join(root, "shared", "corpus_data.json");
        await writeSegmentedJson(shared, retained, {});
        await readSegmentedJson(file, await descriptor(file), {
            reuseVerified: true,
        });
        await rm(path.dirname(file), { recursive: true });
        await rm(path.dirname(next), { recursive: true });
        await collectJsonSegments(root);
        expect(await readdir(blobs)).not.toContain(privateBlock);
        expect(
            (await readdir(blobs)).filter((name) => name.endsWith(".bin")),
        ).toHaveLength(1);
        expect(
            await readSegmentedJson(shared, await descriptor(shared), {
                reuseVerified: true,
            }),
        ).toEqual(retained);
    });
});
