// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    PromptSection,
    Result,
    TypeChatJsonTranslator,
    TypeChatLanguageModel,
    createJsonTranslator,
    success,
} from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { ActionTerm, EntityTerm, SearchFilter } from "./searchSchema.js";
import { loadSchema } from "typeagent";
import {
    ConversationSearchResult,
    createPropertySearchTerm,
    createSearchTerm,
    PropertySearchTerm,
    searchConversation,
    SearchOptions,
    SearchTermGroup,
    WhenFilter,
} from "./search.js";
import { PropertyNames } from "./propertyIndex.js";
import { conversation as kpLib } from "knowledge-processor";
import { getTimeRangeForConversation } from "./conversation.js";
import { IConversation } from "./interfaces.js";

export type SearchTranslator = TypeChatJsonTranslator<SearchFilter>;

export function createSearchTranslator(
    model: TypeChatLanguageModel,
): SearchTranslator {
    const typeName = "SearchFilter";
    const searchActionSchema = loadSchema(
        ["dateTimeSchema.ts", "searchSchema.ts"],
        import.meta.url,
    );

    const validator = createTypeScriptJsonValidator<SearchFilter>(
        searchActionSchema,
        typeName,
    );
    return createJsonTranslator<SearchFilter>(model, validator);
}

export function createSearchGroupFromSearchFilter(
    filter: SearchFilter,
): SearchTermGroup {
    const searchGroup: SearchTermGroup = { booleanOp: "or", terms: [] };
    if (filter.entities) {
        for (const entityFilter of filter.entities) {
            searchGroup.terms.push(
                ...createPropertySearchTermsFromEntityTerm(entityFilter),
            );
        }
    }
    if (filter.action) {
        searchGroup.terms.push(
            ...createPropertySearchTermFromActionTerm(filter.action),
        );
    }
    if (filter.searchTerms) {
        for (const term of filter.searchTerms) {
            searchGroup.terms.push(createSearchTerm(term));
        }
    }
    return searchGroup;
}

export function createWhenFromSearchFilter(filter: SearchFilter): WhenFilter {
    const when: WhenFilter = {};
    if (filter.timeRange) {
        when.dateRange = {
            start: kpLib.toStartDate(filter.timeRange.startDate),
            end: kpLib.toStopDate(filter.timeRange.stopDate),
        };
    }
    return when;
}

function createPropertySearchTermsFromEntityTerm(
    entityTerm: EntityTerm,
): PropertySearchTerm[] {
    const terms: PropertySearchTerm[] = [];
    if (entityTerm.name) {
        terms.push(
            createPropertySearchTerm(PropertyNames.EntityName, entityTerm.name),
        );
    }
    if (entityTerm.type) {
        terms.push(
            ...entityTerm.type.map((t) =>
                createPropertySearchTerm(PropertyNames.EntityType, t),
            ),
        );
    }
    if (entityTerm.facets && entityTerm.facets.length > 0) {
        terms.push(
            ...entityTerm.facets.map((f) =>
                createPropertySearchTerm(f.name, f.value),
            ),
        );
    }
    return terms;
}

function createPropertySearchTermFromActionTerm(
    actionTerm: ActionTerm,
): PropertySearchTerm[] {
    const terms: PropertySearchTerm[] = [];
    if (actionTerm.verbs) {
        terms.push(
            ...actionTerm.verbs.words.map((w) =>
                createPropertySearchTerm(PropertyNames.Verb, w),
            ),
        );
    }
    if (actionTerm.from !== "none") {
        terms.push(
            createPropertySearchTerm(
                PropertyNames.Subject,
                actionTerm.from.text,
            ),
        );
    }
    if (actionTerm.to) {
        terms.push(
            createPropertySearchTerm(PropertyNames.Object, actionTerm.to.text),
        );
    }
    return terms;
}

export function getTimeRangePromptSectionForConversation(
    conversation: IConversation,
): PromptSection[] {
    const timeRange = getTimeRangeForConversation(conversation);
    if (timeRange) {
        return [
            {
                role: "system",
                content: `ONLY IF user request explicitly asks for time ranges, THEN use the CONVERSATION TIME RANGE: "${timeRange.start} to ${timeRange.end}"`,
            },
        ];
    }
    return [];
}

export async function searchConversationWithNaturalLanguage(
    conversation: IConversation,
    searchTranslator: SearchTranslator,
    query: string,
    options?: SearchOptions,
): Promise<Result<[ConversationSearchResult | undefined, SearchFilter]>> {
    const result = await searchTranslator.translate(
        query,
        getTimeRangePromptSectionForConversation(conversation),
    );
    if (!result.success) {
        return result;
    }
    const filter = result.data;
    const terms = createSearchGroupFromSearchFilter(filter);
    const when = createWhenFromSearchFilter(filter);
    const searchResults = await searchConversation(
        conversation,
        terms,
        when,
        options,
    );
    return success([searchResults, filter]);
}
