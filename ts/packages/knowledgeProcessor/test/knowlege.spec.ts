// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
dotenv.config({ path: new URL("../../../../.env", import.meta.url) });

import {
    cleanDir,
    createTestModels,
    getRootDataPath,
    loadData,
    shouldSkip,
    skipTest,
    TestModels,
} from "./testCore.js";
import { conversation, createKnowledgeStore } from "../src/index.js";
import { asyncArray } from "typeagent";
import path from "path";

describe("KnowledgeExtractor", () => {
    const testTimeout = 120000;
    interface TestContext {
        models: TestModels;
    }
    let g_context: TestContext | undefined;

    beforeAll(() => {
        getContext();
    });
    shouldSkip()
        ? skipTest("extract")
        : test(
              "generate",
              async () => {
                  const context = getContext();
                  const testFile = "test/data/play.txt";
                  const blocks = await loadData(testFile);
                  const extractor = conversation.createKnowledgeExtractor(
                      context.models.chat,
                  );
                  const knowledge = await asyncArray.mapAsync(
                      blocks,
                      4,
                      (block) => extractor.extract(block.value),
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
    test("tags", async () => {
        //const context = getContext();
        const store = await createStore("tags");
        let items = ["Banana", "Apple", "Orange"];
        let itemIds = await asyncArray.mapAsync(items, 1, (item) =>
            store.add(item),
        );
        let tag = "Fruit";
        await store.addTag(tag, itemIds);
        let foundIds = await store.getByTag(tag);
        expect(foundIds).toBeDefined();
        expect(foundIds).toEqual(itemIds);
    });

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
