// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel } from "aiclient";
import * as kp from "knowpro";
import { createKnowledgeModel } from "./models.js";

export class KnowproContext {
    public knowledgeModel: ChatModel;
    public basePath: string;
    public conversation?: kp.IConversation | undefined;
    public queryTranslator: kp.SearchQueryTranslator;
    public answerGenerator: kp.AnswerGenerator;

    constructor(basePath?: string) {
        this.basePath = basePath ?? "/data/testChat/knowpro";
        this.knowledgeModel = createKnowledgeModel();
        this.queryTranslator = kp.createSearchQueryTranslator(
            this.knowledgeModel,
        );
        this.answerGenerator = new kp.AnswerGenerator(
            kp.createAnswerGeneratorSettings(this.knowledgeModel),
        );
    }

    public ensureConversationLoaded(): kp.IConversation {
        if (!this.conversation) {
            throw new Error("No conversation loaded");
        }
        return this.conversation!;
    }
}
