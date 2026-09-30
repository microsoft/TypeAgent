// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDocMemorySettings } from "@typeagent/conversation-memory";
import {
    createKnowProCorpusIndex,
    createMemoryServiceRpcFacade,
    FileMemoryService,
} from "@typeagent/memory-service";
import { ConversationDurableMemory } from "../src/context/conversationDurableMemory.js";
import {
    rememberConversation,
    searchPersonalMemory,
    searchReasoningConversationMemory,
} from "../src/context/personalMemorySearch.js";

describe("KnowPro conversation recall through reasoning", () => {
    it("recalls a troubleshooting decision after restart, preserves trust and citations, and does not revive a forgotten turn", async () => {
        const root = path.join(
            os.tmpdir(),
            `conversation-recall-${randomUUID()}`,
        );
        const previousProvider = process.env.TYPEAGENT_EMBEDDING_PROVIDER;
        process.env.TYPEAGENT_EMBEDDING_PROVIDER = "none";
        const languageModel = {
            completionSettings: {},
            complete: async () => ({
                success: true as const,
                data: JSON.stringify({
                    searchExpressions: [
                        {
                            rewrittenQuery: "Zephyr incident recovery",
                            filters: [
                                {
                                    entitySearchTerms: [
                                        {
                                            name: "Zephyr",
                                            isNamePronoun: false,
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                }),
            }),
        };
        const knowledgeFor = (text: string) => ({
            entities: [
                {
                    name: text.includes("Zephyr") ? "Zephyr" : "Credentials",
                    type: ["service"],
                },
            ],
            topics: [
                text.includes("Zephyr")
                    ? "incident recovery"
                    : "credential rotation",
            ],
            actions: [],
            inverseActions: [],
        });
        const options = {
            eventIndexFactory: (corpusId: string, directory: string) =>
                createKnowProCorpusIndex(corpusId, directory, () => {
                    const settings = createDocMemorySettings(
                        64,
                        undefined,
                        languageModel,
                    );
                    settings.embeddingSize = 0;
                    settings.conversationSettings.semanticRefIndexSettings.knowledgeExtractor =
                        {
                            settings: { maxContextLength: 1000 },
                            extract: async (text) => knowledgeFor(text),
                            extractWithRetry: async (text) => ({
                                success: true,
                                data: knowledgeFor(text),
                            }),
                        };
                    return settings;
                }),
        };
        let service = new FileMemoryService(root, options);
        try {
            const durable = new ConversationDurableMemory({
                service: createMemoryServiceRpcFacade(service),
                conversationId: "incident-zephyr",
                runId: "diagnosis",
            });
            durable.recordAssistantEvidence(
                "A restart will probably fix Zephyr.",
                "turn-1",
            );
            durable.recordActionResult(
                "Zephyr restart failed: database connections still time out.",
                "turn-1",
                "services.restart",
                false,
            );
            await rememberConversation(
                {
                    conversationDurableMemory: durable,
                    currentRequestId: { requestId: "turn-2" },
                },
                "Decision: roll Zephyr back to the previous stable release and inspect database connection limits.",
                "decision",
            );
            await service.close();
            service = new FileMemoryService(root, options);

            const recalled = new ConversationDurableMemory({
                service: createMemoryServiceRpcFacade(service),
                conversationId: "new-chat",
                runId: "follow-up",
            });
            const question =
                "What did we settle on for restoring availability of the gateway?";
            const lookup = () =>
                searchReasoningConversationMemory(
                    { conversationDurableMemory: recalled },
                    question,
                );
            const answerContext = await searchPersonalMemory(
                question,
                lookup,
                createMemoryServiceRpcFacade(service),
            );
            expect(answerContext).toContain("roll Zephyr back");
            expect(answerContext).toContain("explicit decision");
            expect(answerContext).toContain("conversation=incident-zephyr");
            expect(answerContext).toContain("turn=turn-2");
            expect(answerContext).toContain("outcome=failed");
            expect(answerContext).toContain("not authoritative fact");

            const forgetter = new ConversationDurableMemory({
                service,
                conversationId: "incident-zephyr",
                runId: "forget",
            });
            await forgetter.forgetTurn("turn-2");
            await service.close();
            service = new FileMemoryService(root, options);
            const afterForget = new ConversationDurableMemory({
                service,
                conversationId: "another-chat",
                runId: "after-forget",
            });
            const remaining = await searchReasoningConversationMemory(
                { conversationDurableMemory: afterForget },
                question,
            );
            expect(remaining).not.toContain("roll Zephyr back");
            expect(remaining).toContain("outcome=failed");
            await expect(
                service.appendEvent({
                    corpusId: (await service.listCorpora())[0].corpusId,
                    idempotencyKey: "history-replay",
                    producer: {
                        producerId: "typeagent.server.backfill",
                        producerType: "conversation-producer",
                    },
                    eventType: "user-turn",
                    sourceKind: "conversation",
                    conversationId: "incident-zephyr",
                    turnId: "turn-2",
                    content: "Decision: roll Zephyr back.",
                }),
            ).rejects.toMatchObject({ code: "EVENT_FORGOTTEN" });
        } finally {
            try {
                await service.close();
            } finally {
                if (previousProvider === undefined) {
                    delete process.env.TYPEAGENT_EMBEDDING_PROVIDER;
                } else {
                    process.env.TYPEAGENT_EMBEDDING_PROVIDER = previousProvider;
                }
                await rm(root, { recursive: true, force: true });
            }
        }
    });
});
