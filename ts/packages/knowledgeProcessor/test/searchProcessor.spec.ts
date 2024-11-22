// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
dotenv.config({ path: new URL("../../../../.env", import.meta.url) });

import { createTestModels, shouldSkip, skipTest } from "./testCore.js";
import path from "path";
import fs from "fs";
import { ConversationManager } from "../src/conversation/conversationManager.js";
import { createEmailMemory } from "../src/email/email.js";
import { createConversationSettings } from "../src/conversation/conversation.js";
import { SearchTermsActionV2 } from "../src/conversation/knowledgeTermSearchSchema2.js";
import { readAllText, readJsonFile } from "typeagent";
import { SearchProcessingOptions } from "../src/conversation/searchProcessor.js";

// TODO: this test is not enabled on all dev machines yet. Currently requires some private datasets and indexes

const testDataPath = "/data/test/search";
const testIndexRootPath = "/data/testChat";
const testIndexName = "outlook";

type TestContext = {
    emails: ConversationManager | undefined;
};
let g_context: TestContext | undefined;

type TestQuery = {
    query: string;
    action: SearchTermsActionV2;
};

const timeoutMs = 1000 * 60 * 5;

describe("SearchProcessor", () => {
    beforeAll(async () => {
        await getContext();
    });
    shouldSkipTest()
        ? skipTest("searchEmail")
        : test(
              "searchEmail",
              async () => {
                  const context = await getContext();
                  const test = await loadTestQuery(testDataPath, "query_1");
                  const options = createOptions();
                  const result =
                      await context.emails?.searchProcessor.searchTermsV2(
                          test.query,
                          getFilters(test),
                          options,
                      );
                  expect(result?.response).toBeDefined();
                  expect(result?.response?.hasMessages).toBeTruthy();
              },
              timeoutMs,
          );

    function shouldSkipTest() {
        return (
            shouldSkip() ||
            !fs.existsSync(path.join(testIndexRootPath, testIndexName)) ||
            !fs.existsSync(testDataPath)
        );
    }

    function createOptions(): SearchProcessingOptions {
        return {
            maxMatches: 2,
            minScore: 0.8,
            maxMessages: 10,
        };
    }
});

async function loadTestQuery(
    rootPath: string,
    name: string,
): Promise<TestQuery> {
    const query = await readAllText(path.join(rootPath, name + ".txt"));
    const actionPath = path.join(rootPath, name + ".json");
    const action: SearchTermsActionV2 | undefined =
        await readJsonFile(actionPath);
    if (!action) {
        throw Error(`Could not load ${actionPath}`);
    }
    return {
        query,
        action,
    };
}

function getFilters(test: TestQuery) {
    if (test.action.actionName === "getAnswer") {
        return test.action.parameters.filters;
    }

    throw Error(`No filters for ${test.query}`);
}

async function getContext(): Promise<TestContext> {
    if (!g_context) {
        const models = await createTestModels();
        g_context = {
            emails: fs.existsSync(path.join(testIndexRootPath, testIndexName))
                ? await createEmailMemory(
                      models.chat,
                      models.answerModel,
                      testIndexName,
                      testIndexRootPath,
                      createConversationSettings(models.embeddings),
                  )
                : undefined,
        };
    }
    return g_context;
}
