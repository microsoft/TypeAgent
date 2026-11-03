// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    truncate,
    writeFile,
} from "node:fs/promises";
import {
    isSegmentedJson,
    jsonSegmentDirectory,
    writeSegmentedJson,
} from "@typeagent/knowpro";
import os from "node:os";
import path from "node:path";
import { ViewIndexPool } from "../src/viewIndexPool.js";
import { ReadCacheInvalidatedError } from "../src/immutableReadCache.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";

describe("immutable published view readers", () => {
    let directory: string;
    let root: string;
    let pool: ViewIndexPool;
    let loads: number;
    let block: Promise<void> | undefined;

    beforeEach(async () => {
        root = await mkdtemp(path.join(os.tmpdir(), "view-reader-pool-"));
        directory = path.join(root, "view");
        await mkdir(directory);
        loads = 0;
        block = undefined;
        await writeFile(
            path.join(directory, "index-schema.json"),
            JSON.stringify({
                indexSchemaVersion: 1,
                engine: "knowpro",
                indexKind: "views",
            }),
        );
        await writeFile(
            path.join(directory, "corpus_data.json"),
            JSON.stringify({
                messages: [{ textChunks: ["synthetic"] }],
                semanticRefs: [],
            }),
        );
        await writeFile(path.join(directory, "ready"), "r1");
        pool = new ViewIndexPool((_corpusId, root) => {
            const index = new FakeSemanticCorpusIndex(root);
            index.initialize = async () => {
                loads++;
                await block;
            };
            return index;
        });
    });
    afterEach(async () => {
        pool.close();
        await rm(root, { recursive: true, force: true });
    });

    test("warmup and concurrent searches share the initialized reader", async () => {
        const [warm, first, second] = await Promise.all([
            pool.warm("corpus", directory, "r1", false),
            pool.acquire("corpus", directory, "r1"),
            pool.acquire("corpus", directory, "r1"),
        ]);
        expect(warm).toBe(true);
        expect(first).toBe(second);
        expect(loads).toBe(1);
        expect(await pool.acquire("corpus", directory, "r1")).toBe(first);
        expect(loads).toBe(1);
    });

    test("cached readers do not hide changed ready markers or corrupt data", async () => {
        await pool.acquire("corpus", directory, "r1");
        await writeFile(path.join(directory, "ready"), "wrong");
        await expect(pool.acquire("corpus", directory, "r1")).rejects.toThrow(
            "does not match the exact revision",
        );
        await writeFile(path.join(directory, "ready"), "r1");
        await writeFile(path.join(directory, "corpus_data.json"), "{bad");
        await expect(pool.acquire("corpus", directory, "r1")).rejects.toThrow();
    });

    test("cached readers still verify content-addressed publication artifacts", async () => {
        const file = path.join(directory, "corpus_data.json");
        await writeSegmentedJson(
            file,
            { messages: [{ textChunks: ["synthetic"] }], semanticRefs: [] },
            { messages: 1, semanticRefs: 0 },
        );
        const descriptor: unknown = JSON.parse(await readFile(file, "utf8"));
        if (!isSegmentedJson(descriptor))
            throw new Error("Expected segmented index");
        await pool.acquire("corpus", directory, "r1");
        const segments = path.join(root, jsonSegmentDirectory);
        const artifact = (await readdir(segments)).find(
            (name) => name !== `${descriptor.root}.json`,
        );
        if (!artifact) throw new Error("Expected a publication artifact");
        await writeFile(path.join(segments, artifact), "corrupted");
        await expect(pool.acquire("corpus", directory, "r1")).rejects.toThrow(
            "Corrupt JSON segment",
        );
    });

    test("privacy invalidation rejects a pending load and later reads load again", async () => {
        let release!: () => void;
        let entered!: () => void;
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        block = new Promise<void>((resolve) => {
            release = resolve;
        });
        const factoryPool = new ViewIndexPool((_corpusId, root) => {
            const index = new FakeSemanticCorpusIndex(root);
            index.initialize = async () => {
                loads++;
                entered();
                await block;
            };
            return index;
        });
        const pending = factoryPool.acquire("corpus", directory, "r1");
        const rejected = expect(pending).rejects.toBeInstanceOf(
            ReadCacheInvalidatedError,
        );
        await started;
        factoryPool.invalidate("corpus");
        release();
        await rejected;
        block = undefined;
        await factoryPool.acquire("corpus", directory, "r1");
        expect(loads).toBe(2);
        factoryPool.close();
    });

    test("even priority warmup skips oversized readers while foreground reads remain available", async () => {
        const embeddings = path.join(directory, "corpus_embeddings.bin");
        await writeFile(embeddings, "");
        await truncate(embeddings, 33 * 1024 * 1024);
        expect(await pool.warm("corpus", directory, "r1", true)).toBe(false);
        expect(loads).toBe(0);
        await pool.acquire("corpus", directory, "r1");
        await pool.acquire("corpus", directory, "r1");
        expect(loads).toBe(2);
    });
});
