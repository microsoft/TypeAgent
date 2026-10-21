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
import {
    collectJsonSegments,
    isSegmentedJson,
    readSegmentedJson,
    writeSegmentedJson,
} from "../src/segmentedJson.js";

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
        expect(changedBytes).toBeLessThan(20_000);
        expect(changedBytes).toBeLessThan(
            Buffer.byteLength(JSON.stringify(data)) / 20,
        );
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
            isSegmentedJson({ ...value, segmentedJsonVersion: 2 }),
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
});
