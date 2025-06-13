// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel, openai } from "aiclient";
import * as kp from "knowpro";
import { Result } from "typechat";
import { getLangSearchResult } from "./searchLang.js";

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

    public async runAnswerSearch(
        request: SearchRequest,
    ): Promise<[Result<kp.ConversationSearchResult[]>, AnswerDebugContext]> {
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
        const searchResults = await this.getSearchResults(
            searchText,
            options,
            langFilter,
            debugContext,
        );
        return [searchResults, debugContext];
    }

    private async getSearchResults(
        searchText: string,
        options?: kp.LanguageSearchOptions,
        langFilter?: kp.LanguageSearchFilter,
        debugContext?: kp.LanguageSearchDebugContext,
    ) {
        const searchResults = getLangSearchResult(
            this.conversation!,
            this.queryTranslator,
            searchText,
            options,
            langFilter,
            debugContext,
        );
        return searchResults;
    }
}

export interface SearchRequest {
    query: string;
    ktype: kp.KnowledgeType;
    fallback?: boolean | undefined;
    tag?: string | undefined;
    thread?: string | undefined;
    exact?: boolean | undefined;
    exactScope?: boolean | undefined;
    applyScope?: boolean | undefined;
    messageTopK?: number | undefined;
    charBudget?: number | undefined;
}

export interface AnswerRequest extends SearchRequest {}

export function createKnowledgeModel() {
    const chatModelSettings = openai.apiSettingsFromEnv(openai.ModelType.Chat);
    chatModelSettings.retryPauseMs = 10000;
    return openai.createJsonChatModel(chatModelSettings, ["knowproTest"]);
}

export interface AnswerDebugContext extends kp.LanguageSearchDebugContext {
    searchText: string;
}

export function createSearchOptions(request: SearchRequest): kp.SearchOptions {
    let options = kp.createSearchOptions();
    options.exactMatch = request.exact;
    options.maxMessageMatches = request.messageTopK;
    options.maxCharsInBudget = request.charBudget;
    return options;
}

export function createLangFilter(
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
