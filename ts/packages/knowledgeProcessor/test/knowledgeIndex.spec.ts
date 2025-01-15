// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import path from "path";
import { getRootDataPath, hasTestKeys, testIf } from "./testCore.js";
import { cleanDir } from "typeagent";
import { createTextIndex } from "../src/textIndex.js";
import { TextBlock, TextBlockType } from "../src/text.js";
dotenv.config({ path: new URL("../../../../.env", import.meta.url) });

describe("KnowledgeIndex", () => {
    const testTimeout = 120000;

    let fruitItems = ["Banana", "Apple", "Orange"];
    //let veggieItems = ["Spinach", "Broccoli", "Carrot"];

    test(
        "textIndex_exact",
        async () => {
            const textIndex = await createIndex("textIndex_exact", false);
            const fruitBlocks = makeBlocks(fruitItems);
            const textIds = await textIndex.putMultiple(fruitBlocks);
            const textIds2 = await textIndex.getIds(fruitItems);
            expect(textIds.sort()).toEqual(textIds2.sort());
        },
        testTimeout,
    );

    testIf(
        "textIndex",
        () => hasTestKeys(),
        async () => {
            const textIndex = await createIndex("textIndex_nearest", true);
            const fruitBlocks = makeBlocks(fruitItems);
            await textIndex.putMultiple(fruitBlocks);
            const matchedText = await textIndex.getNearestText("Mango", 3);
            expect(matchedText.length).toBeGreaterThan(0);
            const matches = await textIndex.getNearest("Mango", 3);
            expect(matches.length).toBeGreaterThan(0);
        },
    );
    async function createIndex(name: string, semanticIndex: boolean) {
        //const context = getContext();
        const rootPath = path.join(getRootDataPath(), name);
        await cleanDir(rootPath);
        return await createTextIndex(
            { caseSensitive: false, semanticIndex, concurrency: 2 },
            rootPath,
        );
    }

    function makeBlocks(strings: string[]): TextBlock[] {
        return strings.map((s, i) => {
            return {
                type: TextBlockType.Raw,
                value: s,
                sourceIds: [i],
            };
        });
    }
});
