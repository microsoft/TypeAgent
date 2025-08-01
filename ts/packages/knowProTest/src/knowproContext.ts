// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel, TextEmbeddingModel, openai } from "aiclient";
import * as kp from "knowpro";
import { createKnowledgeModel } from "./models.js";
import * as cm from "conversation-memory";
import { KnowproLog } from "./logging.js";
import path from "path";
import { createEmbeddingCache } from "knowledge-processor";
import { PromptSection } from "typechat";

export class KnowproContext {
    public knowledgeModel: ChatModel;
    public similarityModel: TextEmbeddingModel;
    public basePath: string;
    public conversation?: kp.IConversation | undefined;
    public queryTranslator: kp.SearchQueryTranslator;
    public answerGenerator: kp.AnswerGenerator;
    public termParser: cm.SearchTermParser;
    public retryNoAnswer: boolean;
    public log: KnowproLog;

    public tokenStats: openai.CompletionUsageStats;
    public promptHandler?:
        | ((request: PromptSection[], response: string) => void)
        | undefined;

    constructor(basePath?: string) {
        this.basePath = basePath ?? "/data/testChat/knowpro";
        this.log = new KnowproLog(path.join(this.basePath, "logs"));
        this.knowledgeModel = createKnowledgeModel();
        this.knowledgeModel.completionCallback = (request, response) =>
            this.completionHandler(request, response);
        this.similarityModel = createEmbeddingCache(
            openai.createEmbeddingModel(),
            1024,
        );
        this.queryTranslator = kp.createSearchQueryTranslator(
            this.knowledgeModel,
        );
        this.answerGenerator = new kp.AnswerGenerator(
            kp.createAnswerGeneratorSettings(this.knowledgeModel),
        );
        this.retryNoAnswer = false;
        this.termParser = new cm.SearchTermParser();
        this.tokenStats = {
            completion_tokens: 0,
            prompt_tokens: 0,
            total_tokens: 0,
        };
    }

    public ensureConversationLoaded(): kp.IConversation {
        if (!this.conversation) {
            throw new Error("No conversation loaded");
        }
        return this.conversation!;
    }

    public createMemorySettings(): cm.MemorySettings {
        return cm.createMemorySettings(64, undefined, this.knowledgeModel);
    }

    private completionHandler(request: any, response: any): void {
        this.updateTokenCounts(response.usage);
        if (this.promptHandler) {
            const messages: PromptSection[] = request.messages;
            const responseText = response.choices[0]?.message?.content ?? "";
            this.promptHandler(messages, responseText);
        }
    }

    public startTokenCounter(): void {
        this.tokenStats = {
            completion_tokens: 0,
            prompt_tokens: 0,
            total_tokens: 0,
        };
    }

    private updateTokenCounts(counter: openai.CompletionUsageStats): void {
        this.tokenStats.completion_tokens += counter.completion_tokens;
        this.tokenStats.prompt_tokens += counter.prompt_tokens;
        this.tokenStats.total_tokens += counter.total_tokens;
    }
}
