// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
dotenv.config({ path: new URL("../../../../.env", import.meta.url) });

import {
    createTestModels,
    loadData,
    shouldSkip,
    skipTest,
    TestModels,
} from "./testCore.js";
import { conversation } from "../src/index.js";
import { asyncArray } from "typeagent";

const testTimeout = 120000;
interface TestContext {
    models: TestModels;
}
let g_context: TestContext | undefined;

describe("KnowledgeExtractor", () => {
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
});

function getContext(): TestContext {
    if (!g_context) {
        g_context = createContext();
    }
    return g_context;
}

export function createContext(): TestContext {
    return {
        models: createTestModels(),
    };
}
