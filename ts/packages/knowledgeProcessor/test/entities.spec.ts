// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createSemanticList } from "typeagent";
import { cleanDir, getRootDataPath, hasTestKeys, testIf } from "./testCore.js";
import { openai, TextEmbeddingModel } from "aiclient";
import { createEntitySearchOptions } from "../src/conversation/entities.js";
import { createNameIndex } from "../src/conversation/nameIndex.js";
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
            await index.addAlias("Jane Austen", "Austen");
            await index.addAlias("Jane Porter", "Porter");
            const ids = await index.get("Porter");
            expect(ids).toBeDefined();
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
});
