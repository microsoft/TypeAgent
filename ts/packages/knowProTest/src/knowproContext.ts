// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel, TextEmbeddingModel, openai } from "aiclient";
import * as kp from "knowpro";
import { createKnowledgeModel } from "./models.js";
import * as cm from "conversation-memory";
import { KnowproLog } from "./logging.js";
import path from "path";
import { createEmbeddingCache } from "knowledge-processor";

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

    constructor(basePath?: string) {
        this.basePath = basePath ?? "/data/testChat/knowpro";
        this.log = new KnowproLog(path.join(this.basePath, "logs"));
        this.knowledgeModel = createKnowledgeModel();
        this.knowledgeModel.completionCallback = (_, response) =>
            this.updateTokenCounts(response.usage);
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
