// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createJsonTranslator,
    PromptSection,
    Result,
    TypeChatLanguageModel,
    error,
    TypeChatJsonTranslator,
} from "typechat";
import * as querySchema from "./searchQuerySchema.js";
import * as querySchema2 from "./searchQuerySchema_v2.js";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { loadSchema } from "typeagent";
import { getTimeRangePromptSectionForConversation } from "./conversation.js";
import { IConversation } from "./interfaces.js";

/**
 * A TypeChat Translator that turns natural language into structured queries
 * of type: {@link SearchQuery}
 */
export interface SearchQueryTranslator {
    translate(
        request: string,
        promptPreamble?: string | PromptSection[],
    ): Promise<Result<querySchema.SearchQuery>>;
    /**
     * Experimental. Translate to new schema:  querySchema2.SearchQuery
     * @param request
     * @param promptPreamble
     * @returns {querySchema2.SearchQuery}
     */
    translate2?: (
        request: string,
        promptPreamble?: string | PromptSection[],
    ) => Promise<Result<querySchema2.SearchQuery>>;
}

/**
 * Create a query translator using
 * @param {TypeChatLanguageModel} model
 * @returns {SearchQueryTranslator}
 */
export function createSearchQueryTranslator(
    model: TypeChatLanguageModel,
): SearchQueryTranslator {
    const translator = createSearchQueryJsonTranslator<querySchema.SearchQuery>(
        model,
        "searchQuerySchema.ts",
    );
    const translator_V2 =
        createSearchQueryJsonTranslator<querySchema2.SearchQuery>(
            model,
            "searchQuerySchema_v2.ts",
        );
    return {
        translate(request, promptPreamble) {
            return translator.translate(request, promptPreamble);
        },
        translate2(request, promptPreamble) {
            return translator_V2.translate(request, promptPreamble);
        },
    };
}

/**
 * Create a query translator using
 * @param {TypeChatLanguageModel} model
 * @param schemaFilePath Relative path to schema file
 * @returns {SearchQueryTranslator}
 */
export function createSearchQueryJsonTranslator<
    T extends querySchema.SearchQuery | querySchema2.SearchQuery,
>(
    model: TypeChatLanguageModel,
    schemaFilePath: string,
): TypeChatJsonTranslator<T> {
    const typeName = "SearchQuery";
    const searchActionSchema = loadSchema(
        ["dateTimeSchema.ts", schemaFilePath],
        import.meta.url,
    );
    return createJsonTranslator<T>(
        model,
        createTypeScriptJsonValidator<T>(searchActionSchema, typeName),
    );
}

/**
 * Translate natural language query into a SearchQuery expression
 * @param conversation
 * @param queryTranslator
 * @param text
 * @param promptPreamble
 * @returns
 */
export async function searchQueryFromLanguage(
    conversation: IConversation,
    queryTranslator: SearchQueryTranslator,
    text: string,
    promptPreamble?: PromptSection[],
): Promise<Result<querySchema.SearchQuery>> {
    const timeRange = getTimeRangePromptSectionForConversation(conversation);
    let queryContext: PromptSection[] =
        promptPreamble && promptPreamble.length > 0
            ? [...promptPreamble, ...timeRange]
            : timeRange;
    const result = await queryTranslator.translate(text, queryContext);
    return result;
}

/**
 * Experimental: translate search query to SearchQuery v2
 * @param conversation
 * @param queryTranslator
 * @param text
 * @param promptPreamble
 * @returns {querySchema2.SearchQuery}
 */
export async function searchQueryFromLanguage2(
    conversation: IConversation,
    queryTranslator: SearchQueryTranslator,
    text: string,
    promptPreamble?: PromptSection[],
): Promise<Result<querySchema2.SearchQuery>> {
    if (!queryTranslator.translate2) {
        return error("Scoped queries not supported");
    }
    const timeRange = getTimeRangePromptSectionForConversation(conversation);
    let queryContext: PromptSection[] =
        promptPreamble && promptPreamble.length > 0
            ? [...promptPreamble, ...timeRange]
            : timeRange;
    const result = await queryTranslator.translate2(text, queryContext);
    return result;
}
