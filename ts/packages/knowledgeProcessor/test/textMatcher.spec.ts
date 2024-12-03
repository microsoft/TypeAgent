// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createSemanticList } from "typeagent";
import { cleanDir, getRootDataPath, hasTestKeys, testIf } from "./testCore.js";
import { openai, TextEmbeddingModel } from "aiclient";
import { createEntitySearchOptions } from "../src/conversation/entities.js";
import { createAliasMatcher } from "../src/textMatcher.js";
import { createFileSystemStorageProvider } from "../src/storageProvider.js";
import path from "path";
//import { TextBlock, TextBlockType } from "./text.js";

describe("TextMatchers", () => {
    const testTimeoutMs = 1000 * 60 * 5;
    let embeddingModel: TextEmbeddingModel | undefined;
    let names = [
        "Kevin",
        "Kevin Andersen",
        "Kevin Bacon",
        "Kevin Durant",
        "Jane Austen",
        "Jane Porter",
        "Jane",
        "Agatha Christie",
        "Agatha",
        "Oscar",
        "Oscar Wilde",
        "Patrick",
        "Patrick Stewart",
    ];

    beforeAll(() => {
        if (hasTestKeys()) {
            embeddingModel = openai.createEmbeddingModel();
        }
    });
    testIf(
        "entityNames",
        () => hasTestKeys(),
        async () => {
            const semanticList = createSemanticList<string>(embeddingModel!);
            await semanticList.pushMultiple(names);

            const searchOptions = createEntitySearchOptions();
            const query = "Kevin";
            const matches = await semanticList.nearestNeighbors(
                query,
                searchOptions.nameSearchOptions?.maxMatches ??
                    searchOptions.maxMatches,
                searchOptions.nameSearchOptions?.minScore ??
                    searchOptions.minScore,
            );
            expect(matches.length).toBeGreaterThan(0);
            const expectedK = names.reduce<number>(
                (total: number, m) => (m.startsWith(query) ? total + 1 : total),
                0,
            );
            const matchCount = matches.reduce<number>(
                (total: number, m) =>
                    m.item.startsWith(query) ? total + 1 : total,
                0,
            );
            expect(matchCount).toBe(expectedK);
        },
        testTimeoutMs,
    );
    test(
        "aliasMatcher",
        async () => {
            const rootPath = path.join(getRootDataPath(), "aliasMatcher");
            await cleanDir(rootPath);
            const provider = createFileSystemStorageProvider(rootPath);
            const index = await createAliasMatcher<string>(
                provider,
                rootPath,
                "aliasMatcher",
                "TEXT",
            );
            const nameIds = nameMap();
            await testAdd("Jane Austen", "Austen", 1);
            await testAdd("Jane Austen", "Jane", 1);
            await testAdd("Jane Porter", "Porter", 1);
            await testAdd("Jane Porter", "Jane", 2);
            await testRemove("Jane Austen", "Austen", 0);
            await testRemove("Jane Austen", "Jane", 1);

            async function testAdd(
                name: string,
                alias: string,
                expectedMatchCount: number,
            ) {
                const nameId = nameIds.get(name);
                await index.addAlias(alias, nameId!);
                let matches = await index.match(alias);
                expect(matches).toBeDefined();
                if (matches) {
                    expect(matches).toHaveLength(expectedMatchCount);
                    expect(matches.some((m) => m.item === nameId)).toBeTruthy();
                }
            }

            async function testRemove(
                name: string,
                alias: string,
                expectedPostingsLength: number,
            ) {
                const nameId = nameIds.get(name);
                await index.removeAlias(alias, nameId!);
                let aliasPostings = await index.match(alias);
                if (expectedPostingsLength > 0) {
                    expect(aliasPostings).toBeDefined();
                    expect(aliasPostings!).toHaveLength(expectedPostingsLength);
                } else {
                    expect(aliasPostings).toBeUndefined();
                }
            }
        },
        testTimeoutMs,
    );
    /*
    function nameBlocks(): TextBlock[] {
        return names.map<TextBlock>((value, i) => {
            return {
                value,
                type: TextBlockType.Sentence,
                sourceIds: [i.toString()],
            };
        });
    }
        */
    function nameMap(): Map<string, string> {
        const map = new Map<string, string>();
        for (let i = 0; i < names.length; ++i) {
            map.set(names[i], i.toString());
        }
        return map;
    }
});
