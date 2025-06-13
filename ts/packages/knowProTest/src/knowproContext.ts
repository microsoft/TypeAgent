// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel, openai } from "aiclient";
import * as kp from "knowpro";
import * as cm from "conversation-memory";
import { SearchRequest } from "./requests.js";
import { Result } from "typechat";

export interface AnswerDebugContext extends kp.LanguageSearchDebugContext {
    searchText: string;
}

export class KnowproContext {
    public knowledgeModel: ChatModel;
    public basePath: string;
    public conversation?: kp.IConversation | undefined;
    public queryTranslator: kp.SearchQueryTranslator;
    public answerGenerator: kp.AnswerGenerator;

    constructor(basePath?: string) {
        this.basePath = basePath ?? "/data/testChat/knowpro";
        this.knowledgeModel = createKnowledgeModel();
        (this.queryTranslator = kp.createSearchQueryTranslator(
            this.knowledgeModel,
        )),
            (this.answerGenerator = new kp.AnswerGenerator(
                kp.createAnswerGeneratorSettings(this.knowledgeModel),
            ));
    }

    public ensureConversationLoaded(): kp.IConversation {
        if (!this.conversation) {
            throw new Error("No conversation loaded");
        }
        return this.conversation!;
    }

    public async execSearchRequest(
        request: SearchRequest,
    ): Promise<[Result<kp.ConversationSearchResult[]>, AnswerDebugContext]> {
        const conversation = this.ensureConversationLoaded();
        const searchText = request.query;
        const debugContext: AnswerDebugContext = { searchText };

        const options: kp.LanguageSearchOptions = {
            ...createSearchOptions(request),
            compileOptions: {
                exactScope: request.exactScope,
                applyScope: request.applyScope,
            },
        };
        options.exactMatch = request.exact;
        if (request.fallback) {
            options.fallbackRagOptions = {
                maxMessageMatches: options.maxMessageMatches,
                maxCharsInBudget: options.maxCharsInBudget,
                thresholdScore: 0.7,
            };
        }
        const langFilter = createLangFilter(undefined, request);
        const searchResults =
            conversation instanceof cm.Memory
                ? await conversation.searchWithLanguage(
                      searchText,
                      options,
                      langFilter,
                      debugContext,
                  )
                : await kp.searchConversationWithLanguage(
                      conversation,
                      searchText,
                      this.queryTranslator,
                      options,
                      langFilter,
                      debugContext,
                  );

        return [searchResults, debugContext];
    }
}

export function createKnowledgeModel() {
    const chatModelSettings = openai.apiSettingsFromEnv(openai.ModelType.Chat);
    chatModelSettings.retryPauseMs = 10000;
    return openai.createJsonChatModel(chatModelSettings, ["knowproTest"]);
}

function createLangFilter(
    when: kp.WhenFilter | undefined,
    request: SearchRequest,
): kp.LanguageSearchFilter | undefined {
    if (request.ktype) {
        when ??= {};
        when.knowledgeType = request.ktype;
    }
    if (request.tag) {
        when ??= {};
        when.tags = [request.tag];
    }
    if (request.thread) {
        when ??= {};
        when.threadDescription = request.thread;
    }
    return when;
}

function createSearchOptions(request: SearchRequest): kp.SearchOptions {
    let options = kp.createSearchOptions();
    options.exactMatch = request.exact;
    options.maxMessageMatches = request.messageTopK;
    options.maxCharsInBudget = request.charBudget;
    return options;
}
