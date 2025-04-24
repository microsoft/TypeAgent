// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createJsonTranslator,
    Result,
    TypeChatJsonTranslator,
    TypeChatLanguageModel,
} from "typechat";
import * as querySchema from "./searchQuerySchema.js";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { loadSchema } from "typeagent";
import { getTimeRangePromptSectionForConversation } from "./conversation.js";
import { IConversation } from "./interfaces.js";
/**
 * A TypeChat Translator that turns natural language into structured queries
 * of type: {@link SearchQuery}
 */
export type SearchQueryTranslator =
    TypeChatJsonTranslator<querySchema.SearchQuery>;

/**
 * Create a query translator using
 * @param {TypeChatLanguageModel} model
 * @returns {SearchQueryTranslator}
 */
export function createSearchQueryTranslator(
    model: TypeChatLanguageModel,
): SearchQueryTranslator {
    const typeName = "SearchQuery";
    const searchActionSchema = loadSchema(
        ["dateTimeSchema.ts", "searchQuerySchema.ts"],
        import.meta.url,
    );

    return createJsonTranslator<querySchema.SearchQuery>(
        model,
        createTypeScriptJsonValidator<querySchema.SearchQuery>(
            searchActionSchema,
            typeName,
        ),
    );
}

export async function searchQueryFromLanguage(
    conversation: IConversation,
    queryTranslator: SearchQueryTranslator,
    text: string,
): Promise<Result<querySchema.SearchQuery>> {
    const result = await queryTranslator.translate(
        text,
        getTimeRangePromptSectionForConversation(conversation),
    );
    return result;
}
