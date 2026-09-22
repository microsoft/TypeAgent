// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanDir } from "@typeagent/agent-runtime";
import { TextEmbeddingModel } from "@typeagent/aiclient";
import {
    addMessageBatchToConversation,
    addMessageToConversation,
} from "../src/conversation/conversationManager.js";
import {
    createConversation,
    createConversationSettings,
} from "../src/conversation/conversation.js";
import { KnowledgeExtractor } from "../src/conversation/knowledge.js";

const rootPath = path.join(
    os.tmpdir(),
    "knowProc-tests",
    "conversationNoEmbedding",
);

const unusedKnowledgeExtractor: KnowledgeExtractor = {
    settings: { maxContextLength: 2048 },
    extract: async () => undefined,
    extractWithRetry: async () => {
        throw new Error("Knowledge extraction is disabled in this test.");
    },
};

const testEmbeddingModel: TextEmbeddingModel = {
    maxBatchSize: 1,
    generateEmbedding: async () => ({
        success: true,
        data: [1, 0],
    }),
};

describe("Conversation without embeddings", () => {
    beforeEach(async () => {
        await cleanDir(rootPath);
    });

    afterAll(async () => {
        await cleanDir(rootPath);
    });

    test("does not create a semantic message index", async () => {
        const settings = createConversationSettings();

        expect(settings.indexSettings.semanticIndex).toBe(false);

        const conversation = await createConversation(settings, rootPath);

        await expect(conversation.getMessageIndex()).resolves.toBeUndefined();
        expect(fs.existsSync(path.join(rootPath, "embeddings"))).toBe(false);
    });

    test("stores messages and preserves exact lookup", async () => {
        const settings = createConversationSettings();
        let conversation = await createConversation(settings, rootPath);

        await addMessageToConversation(
            conversation,
            unusedKnowledgeExtractor,
            undefined,
            { text: "I met Sarah at Contoso yesterday." },
            false,
        );
        await addMessageBatchToConversation(
            conversation,
            unusedKnowledgeExtractor,
            undefined,
            [
                { text: "We discussed the quarterly plan." },
                { text: "The launch is scheduled for Friday." },
            ],
            false,
        );

        expect(await conversation.messages.size()).toBe(3);
        await expect(
            conversation.searchMessages("software company", {
                maxMatches: 1,
            }),
        ).resolves.toBeUndefined();
        expect(
            await conversation.findMessage("I met Sarah at Contoso yesterday."),
        ).toBeDefined();
        expect(
            await conversation.findMessage("This message does not exist."),
        ).toBeUndefined();
        expect(fs.existsSync(path.join(rootPath, "embeddings"))).toBe(false);

        conversation = await createConversation(settings, rootPath);

        expect(
            await conversation.findMessage(
                "The launch is scheduled for Friday.",
            ),
        ).toBeDefined();
        expect(fs.existsSync(path.join(rootPath, "embeddings"))).toBe(false);
    });

    test("keeps thread lookup available without semantic indexing", async () => {
        const settings = createConversationSettings();
        const conversation = await createConversation(settings, rootPath);
        const threadIndex = await conversation.getThreadIndex();
        const thread = {
            type: "temporal" as const,
            description: "Quarterly planning",
            timeRange: {
                startDate: {
                    date: { day: 1, month: 9, year: 2026 },
                },
            },
        };

        await threadIndex.add(thread);

        expect(await threadIndex.get(thread.description)).toEqual([thread]);
        expect(
            fs.existsSync(
                path.join(rootPath, "threads", "description", "embeddings"),
            ),
        ).toBe(false);
    });

    test("keeps semantic message indexing enabled with a model", async () => {
        const settings = createConversationSettings(testEmbeddingModel);
        const conversation = await createConversation(settings, rootPath);

        expect(settings.indexSettings.semanticIndex).toBe(true);
        await addMessageToConversation(
            conversation,
            unusedKnowledgeExtractor,
            undefined,
            { text: "Semantic indexing remains available." },
            false,
        );

        expect(await conversation.getMessageIndex()).toBeDefined();
        expect(
            await conversation.searchMessages("Find the indexed message.", {
                maxMatches: 1,
            }),
        ).toMatchObject({
            messages: [
                {
                    value: {
                        value: "Semantic indexing remains available.",
                    },
                },
            ],
        });
        expect(fs.existsSync(path.join(rootPath, "embeddings"))).toBe(true);
    });
});
