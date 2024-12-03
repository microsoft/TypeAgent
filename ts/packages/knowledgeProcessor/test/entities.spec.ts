// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createSemanticList } from "typeagent";
import { cleanDir, getRootDataPath, hasTestKeys, testIf } from "./testCore.js";
import { openai, TextEmbeddingModel } from "aiclient";
import { createEntitySearchOptions } from "../src/conversation/entities.js";
import {
    createAliasMatcher,
    createNameIndex,
} from "../src/conversation/nameIndex.js";
import { createFileSystemStorageProvider } from "../src/storageProvider.js";
import path from "path";
import { TextBlock, TextBlockType } from "../src/text.js";

describe("Entities", () => {
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
    testIf(
        "aliases",
        () => hasTestKeys(),
        async () => {
            const rootPath = path.join(getRootDataPath(), "aliases");
            await cleanDir(rootPath);
            const provider = createFileSystemStorageProvider(rootPath);
            const index = await createNameIndex(
                provider,
                {
                    caseSensitive: false,
                    concurrency: 1,
                },
                rootPath,
                "alias",
                "TEXT",
            );
            const blocks = nameBlocks();
            await index.putMultiple(blocks);

            await testAlias("Jane Austen", "Austen");
            await testAlias("Jane Porter", "Porter");

            let alias = "Austen";
            await index.removeAlias("Jane Austen", alias);
            let ids = await index.get(alias);
            expect(ids).toBeUndefined();

            async function testAlias(name: string, alias: string) {
                await index.addAlias(name, alias);
                let exactPostings = await index.get(name);
                expect(exactPostings).toBeDefined();
                let aliasPostings = await index.get(alias);
                expect(aliasPostings).toBeDefined();
                expect(aliasPostings).toEqual(exactPostings);
            }
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
            await testAlias("Jane Austen", "Austen");
            await testAlias("Jane Porter", "Porter");

            async function testAlias(name: string, alias: string) {
                const nameId = nameIds.get(name);
                await index.add(alias, nameId!);
                let aliasPostings = await index.match(alias);
                expect(aliasPostings).toBeDefined();
                if (aliasPostings) {
                    expect(aliasPostings).toHaveLength(1);
                    expect(aliasPostings[0].item).toEqual(nameId);
                }
            }
        },
        testTimeoutMs,
    );

    function nameBlocks(): TextBlock[] {
        return names.map<TextBlock>((value, i) => {
            return {
                value,
                type: TextBlockType.Sentence,
                sourceIds: [i.toString()],
            };
        });
    }
    function nameMap(): Map<string, string> {
        const map = new Map<string, string>();
        for (let i = 0; i < names.length; ++i) {
            map.set(names[i], i.toString());
        }
        return map;
    }
});
