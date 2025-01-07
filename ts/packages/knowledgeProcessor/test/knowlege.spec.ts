// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
dotenv.config({ path: new URL("../../../../.env", import.meta.url) });

import {
    createTestModels,
    getRootDataPath,
    hasTestKeys,
    loadData,
    testIf,
    TestModels,
} from "./testCore.js";
import {
    conversation,
    createKnowledgeStore,
    KnowledgeStore,
} from "../src/index.js";
import { asyncArray, cleanDir } from "typeagent";
import path from "path";

describe("KnowledgeExtractor", () => {
    const testTimeout = 120000;
    interface TestContext {
        models: TestModels;
    }
    let g_context: TestContext | undefined;
    let fruitItems = ["Banana", "Apple", "Orange"];
    let veggieItems = ["Spinach", "Broccoli", "Carrot"];

    beforeAll(() => {
        getContext();
    });
    testIf(
        "generate",
        () => hasTestKeys(),
        async () => {
            const context = getContext();
            const testFile = "test/data/play.txt";
            const blocks = await loadData(testFile);
            const extractor = conversation.createKnowledgeExtractor(
                context.models.chat,
            );
            const knowledge = await asyncArray.mapAsync(blocks, 4, (block) =>
                extractor.extract(block.value),
            );
            expect(knowledge).not.toBeUndefined();
            expect(knowledge.length).toBeGreaterThan(0);
            for (const k of knowledge) {
                if (k) {
                    expect(k.entities.length).toBeGreaterThan(0);
                }
            }
        },
        testTimeout,
    );
    testIf(
        "tags",
        () => hasTestKeys(),
        async () => {
            //const context = getContext();
            const store = await createStore("tags");
            await addTags(store, fruitItems, "Fruit");
            await addTags(store, veggieItems, "Veggies");

            const allIds = await store.getByTag(["Fruit", "Veggies"], true);
            expect(allIds).toHaveLength(fruitItems.length + veggieItems.length);
        },
        testTimeout,
    );
    testIf(
        "nameTags",
        () => hasTestKeys(),
        async () => {
            const store = await createStore("nameTags");
            const itemIds = await addItems(store, fruitItems);

            let fullName = " Jane  Austen ";
            const name = conversation.splitParticipantName(fullName);
            expect(name).toBeDefined();
            if (name) {
                expect(name.firstName).toEqual("Jane");
                expect(name.lastName).toEqual("Austen");

                await store.addTag(name.firstName, itemIds);
                await store.addTag(name.lastName!, itemIds);
                const foundIds = await store.getByTag(name.firstName);
                expect(foundIds).toEqual(itemIds);
            }
        },
        testTimeout,
    );

    async function addTags(
        store: KnowledgeStore<string>,
        items: string[],
        tag: string,
    ) {
        await addItems(store, items);
        let itemIds = await asyncArray.mapAsync(items, 1, (item) =>
            store.add(item),
        );
        await store.addTag(tag, itemIds);
        let foundIds = await store.getByTag(tag);
        expect(foundIds).toBeDefined();
        expect(foundIds).toEqual(itemIds);
    }

    async function addItems(
        store: KnowledgeStore<string>,
        items: string[],
    ): Promise<string[]> {
        return await asyncArray.mapAsync(items, 1, (item) => store.add(item));
    }

    async function createStore(name: string) {
        //const context = getContext();
        const rootPath = path.join(getRootDataPath(), name);
        await cleanDir(rootPath);
        return await createKnowledgeStore<string>(
            {
                caseSensitive: false,
                semanticIndex: false,
                concurrency: 1,
                //embeddingModel: context.models.embeddings,
            },
            rootPath,
        );
    }

    function getContext(): TestContext {
        if (!g_context) {
            g_context = createContext();
        }
        return g_context;
    }

    function createContext(): TestContext {
        return {
            models: createTestModels(),
        };
    }
});
