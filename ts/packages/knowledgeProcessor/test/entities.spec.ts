// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createSemanticList, collections } from "typeagent";
import { hasTestKeys, testIf } from "./testCore.js";
import { openai, TextEmbeddingModel } from "aiclient";
import { createEntitySearchOptions } from "../src/conversation/entities.js";

describe("Entities", () => {
    const testTimeoutMs = 1000 * 60 * 5;
    let embeddingModel: TextEmbeddingModel | undefined;

    beforeAll(() => {
        if (hasTestKeys()) {
            embeddingModel = openai.createEmbeddingModel();
        }
    });
    testIf(
        "entityNames",
        () => hasTestKeys(),
        async () => {
            let names = [
                "Kevin",
                "Kevin Andersen",
                "Kevin Bacon",
                "Kevin Durant",
                "Jane Austen",
                "Jane",
                "Agatha Christie",
                "Agatha",
                "Oscar",
                "Oscar Wilde",
                "Patrick",
                "Patrick Stewart",
            ];
            collections.lowerAndSort(names);
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
});
