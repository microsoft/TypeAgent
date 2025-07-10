// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel } from "aiclient";
import * as kp from "knowpro";
import { createKnowledgeModel } from "./models.js";
import * as cm from "conversation-memory";
import { KnowproLog } from "./logging.js";
import path from "path";

export class KnowproContext {
    public knowledgeModel: ChatModel;
    public basePath: string;
    public conversation?: kp.IConversation | undefined;
    public queryTranslator: kp.SearchQueryTranslator;
    public answerGenerator: kp.AnswerGenerator;
    public termParser: cm.SearchTermParser;
    public retryNoAnswer: boolean;
    public log: KnowproLog;

    constructor(basePath?: string) {
        this.basePath = basePath ?? "/data/testChat/knowpro";
        this.log = new KnowproLog(path.join(this.basePath, "logs"));
        this.knowledgeModel = createKnowledgeModel();
        this.queryTranslator = kp.createSearchQueryTranslator(
            this.knowledgeModel,
        );
        this.answerGenerator = new kp.AnswerGenerator(
            kp.createAnswerGeneratorSettings(this.knowledgeModel),
        );
        this.retryNoAnswer = false;
        this.termParser = new cm.SearchTermParser();
    }

    public ensureConversationLoaded(): kp.IConversation {
        if (!this.conversation) {
            throw new Error("No conversation loaded");
        }
        return this.conversation!;
    }
}
