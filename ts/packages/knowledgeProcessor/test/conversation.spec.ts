// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
dotenv.config({ path: new URL("../../../../.env", import.meta.url) });

import { conversation } from "../src/index.js";
import { shouldSkip, skipTest } from "./testCore.js";

export type TestContext = {
    cm: conversation.ConversationManager;
};

let g_context: TestContext | undefined;
const testTimeout = 120000;

describe("Conversation Manager", () => {
    beforeAll(async () => {
        await getContext();
    });
    shouldSkip()
        ? skipTest("addEntities")
        : test(
              "addEntities",
              async () => {
                  const context = await getContext();
                  await addEntities(context.cm);
              },
              testTimeout,
          );
    shouldSkip()
        ? skipTest("search")
        : test(
              "search",
              async () => {
                  const context = await getContext();
                  const query = "What food did we talk about?";
                  let matches = await context.cm.search(query);
                  expect(
                      matches && matches.response && matches.response.answer,
                  );
              },
              testTimeout,
          );
    shouldSkip()
        ? skipTest("searchTerms")
        : test("searchTerms", async () => {
              const context = await getContext();
              const query = "What food did we talk about?";
              const filters: conversation.TermFilter[] = [
                  {
                      terms: ["food"],
                  },
              ];
              let matches = await context.cm.search(query, filters);
              expect(matches && matches.response && matches.response.answer);
          });
});

async function getContext(): Promise<TestContext> {
    if (!g_context) {
        g_context = await createTestContext();
    }
    return g_context;
}

async function createTestContext(): Promise<TestContext> {
    const cm = await conversation.createConversationManager(
        "testConversation",
        "/data/tests",
        true,
    );
    return {
        cm,
    };
}

async function addEntities(
    cm: conversation.ConversationManager,
): Promise<void> {
    const testMessage = "Bach ate pizza while he wrote fugues";
    let entity1: conversation.ConcreteEntity = {
        name: "bach",
        type: ["composer", "person"],
    };
    let entity2: conversation.ConcreteEntity = {
        name: "pizza",
        type: ["food"],
    };
    await cm.addMessage(testMessage, [entity1, entity2]);
}
