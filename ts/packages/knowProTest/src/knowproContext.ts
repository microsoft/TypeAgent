// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel, openai } from "aiclient";
import * as kp from "knowpro";
import * as cm from "conversation-memory";
import {
    AnswerDebugContext,
    GetAnswerRequest,
    GetAnswerResponse,
    SearchRequest,
    SearchResponse,
} from "./requests.js";
import { error, Result, success } from "typechat";

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
    ): Promise<SearchResponse> {
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

        return { searchResults, debugContext };
    }

    public async execGetAnswerRequest(
        request: GetAnswerRequest,
        searchResponse?: SearchResponse,
        progressCallback?: (
            index: number,
            question: string,
            answer: Result<kp.AnswerResponse>,
        ) => void,
    ): Promise<GetAnswerResponse> {
        const conversation = this.ensureConversationLoaded();
        searchResponse =
            searchResponse ?? (await this.execSearchRequest(request));
        const searchResults = searchResponse.searchResults;
        const response: GetAnswerResponse = {
            searchResponse,
            answerResponses: error("Not initialized"),
        };
        if (!searchResults.success) {
            return response;
        }
        if (!kp.hasConversationResults(searchResults.data)) {
            return response;
        }
        const fastStopSav = this.answerGenerator.settings.fastStop;
        if (request.fastStop) {
            this.answerGenerator.settings.fastStop = request.fastStop;
        }
        let answerResponses: kp.AnswerResponse[] = [];
        try {
            if (!request.messages) {
                // Don't include raw message text... try answering only with knowledge
                searchResults.data.forEach((r) => (r.messageMatches = []));
            }
            const choices = request.choices?.split(";");
            const options = createAnswerOptions(request);
            for (let i = 0; i < searchResults.data.length; ++i) {
                const searchResult = searchResults.data[i];
                let question = searchResult.rawSearchQuery ?? request.query;
                if (choices && choices.length > 0) {
                    question = kp.createMultipleChoiceQuestion(
                        question,
                        choices,
                    );
                }
                const answerResult = await kp.generateAnswer(
                    conversation,
                    this.answerGenerator,
                    question,
                    searchResult,
                    undefined,
                    options,
                );
                if (!answerResult.success) {
                    response.answerResponses = answerResult;
                    return response;
                }
                answerResponses.push(answerResult.data);
                if (progressCallback) {
                    progressCallback(i, question, answerResult);
                }
            }
        } finally {
            this.answerGenerator.settings.fastStop = fastStopSav;
        }
        response.answerResponses = success(answerResponses);
        return response;
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

function createAnswerOptions(
    namedArgs: GetAnswerRequest,
): kp.AnswerContextOptions {
    let topK = namedArgs.knowledgeTopK;
    if (topK === undefined) {
        return {};
    }
    const options: kp.AnswerContextOptions = {
        entitiesTopK: topK,
        topicsTopK: topK,
    };
    return options;
}
