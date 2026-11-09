// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { getRuntimeConfig, setRuntimeConfig } from "@typeagent/aiclient";
import { ImageCollection } from "../src/imageCollection.js";
import { Image, ImageMeta } from "../src/imageMeta.js";

describe("image persistence without inference", () => {
    const root = path.resolve(`image-persistence-test-${randomUUID()}`);
    const originalConfig = getRuntimeConfig();
    beforeEach(async () => {
        await fs.mkdir(root, { recursive: true });
        setRuntimeConfig({
            ...originalConfig,
            embedding: { provider: "none", size: 2 },
        });
    });
    afterEach(async () => {
        setRuntimeConfig(originalConfig);
        await fs.rm(root, { recursive: true, force: true });
    });

    test("roundtrips message vectors, metadata and SQLite; saved copies also persist", async () => {
        const meta = new ImageMeta("fixture.png", {
            title: "authored fixture",
            altText: "",
            caption: "",
            width: 1,
            height: 1,
            fileName: "fixture.png",
            dateTaken: "2026-01-01",
            exifData: [
                ["GPSLatitude", 0],
                ["GPSLongitude", 12],
            ],
        });
        meta.getKnowledge();
        meta.dataFrameValues["Artist"] = "fixture author";
        const collection = new ImageCollection("fixture", [
            new Image(["authored control"], meta),
        ]);
        expect(
            collection.settings.messageTextIndexSettings.embeddingIndexSettings
                .embeddingSize,
        ).toBe(2);
        collection.secondaryIndexes.messageIndex!.deserialize({
            indexData: {
                embeddings: [new Float32Array([1, 0])],
                textLocations: [{ messageOrdinal: 0, chunkOrdinal: 0 }],
            },
            messageCount: 1,
        });
        collection.addMetadataToDataFrames();
        await collection.writeToFile(root, "one");
        // Serialization must not empty the live message index.
        expect(
            collection.secondaryIndexes.messageIndex!.serialize().indexData!
                .embeddings,
        ).toHaveLength(1);
        collection.close();
        const loaded = await ImageCollection.readFromFile(root, "one");
        expect(loaded).toBeDefined();
        try {
            expect(
                loaded!.messages.get(0).metadata.dataFrameValues["Artist"],
            ).toBe("fixture author");
            expect(loaded!.messages.get(0).metadata.getGeo()).toEqual({
                latitude: 0,
                longitude: 12,
            });
            expect(
                loaded!.secondaryIndexes.messageIndex!.serialize().indexData!
                    .embeddings[0],
            ).toEqual(new Float32Array([1, 0]));
            expect([...loaded!.locations]).toHaveLength(1);
            await loaded!.writeToFile(root, "two");
        } finally {
            loaded!.close();
        }
        const copy = await ImageCollection.readFromFile(root, "two");
        try {
            expect([...copy!.locations]).toHaveLength(1);
            expect(
                copy!.messages.get(0).metadata.dataFrameValues["GPSLatitude"],
            ).toBe(0);
        } finally {
            copy!.close();
        }
        const moduleUrl = new URL("../imageCollection.js", import.meta.url)
            .href;
        const script = `const {getRuntimeConfig,setRuntimeConfig}=await import('@typeagent/aiclient');setRuntimeConfig({...getRuntimeConfig(),embedding:{provider:'none',size:2}});const {ImageCollection}=await import(${JSON.stringify(moduleUrl)});const c=await ImageCollection.readFromFile(${JSON.stringify(root)},'two');console.log(JSON.stringify({rows:[...c.locations].length,artist:c.messages.get(0).metadata.dataFrameValues.Artist,vectors:c.secondaryIndexes.messageIndex.serialize().indexData.embeddings.length}));c.close();`;
        const output = execFileSync(
            process.execPath,
            ["--input-type=module", "-e", script],
            { encoding: "utf8" },
        );
        expect(JSON.parse(output)).toEqual({
            rows: 1,
            artist: "fixture author",
            vectors: 1,
        });
    });

    test("missing collection returns undefined and legacy buffers reload asynchronously", async () => {
        expect(
            await ImageCollection.readFromFile(root, "absent"),
        ).toBeUndefined();
        const fromBuffer = await ImageCollection.fromBuffer(
            JSON.stringify({
                nameTag: "legacy",
                messages: [],
                tags: [],
                semanticRefs: [],
            }),
            Buffer.alloc(0),
        );
        expect(fromBuffer.nameTag).toBe("legacy");
        fromBuffer.close();
    });
});
