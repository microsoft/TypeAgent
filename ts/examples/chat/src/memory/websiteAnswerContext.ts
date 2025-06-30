// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PromptSection } from "typechat";
import { createChatTranslator, loadSchema } from "typeagent";
import { ChatModel } from "aiclient";
import { WebsiteAnswerResponse } from "./websiteAnswerSchema.js";

/**
 * Create website answer generator with schema-driven responses
 */
export function createWebsiteAnswerGenerator(model: ChatModel) {
    const translator = createChatTranslator<WebsiteAnswerResponse>(
        model,
        loadSchema(["websiteAnswerSchema.ts"], import.meta.url),
        "WebsiteAnswerResponse",
    );

    return translator;
}

/**
 * Create concise website answer instructions following TypeAgent conventions
 */
export function createWebsiteAnswerInstructions(): PromptSection[] {
    return [
        {
            role: "system",
            content: `Answer questions about website bookmarks and browsing history using temporal and frequency facets.

FACET USAGE:
- bookmarkDate/visitDate: For "earliest", "latest", "when" queries - include specific dates
- visitCount/visitFrequency: For "most visited", "popular", "rarely" queries - mention actual numbers
- category/pageType: For "development", "tech", domain-specific queries
- folder/source: For organization and context

TEMPORAL PATTERNS:
- "earliest/first/oldest" → Use bookmarkDate facet, sort ascending, mention date
- "latest/newest/recent" → Use bookmarkDate/visitDate facet, sort descending
- "when did I" → Find specific date using bookmarkDate or visitDate
- Year mentions → Filter by bookmarkYear or visitYear

FREQUENCY PATTERNS:
- "most visited/often" → Use visitCount facet, sort descending, include numbers
- "popular sites" → Use visitFrequency="high" or high visitCount
- "rarely visited" → Use visitFrequency="low" or low visitCount

Include relevant facet values in responses for context and insights.`,
        },
    ];
}

/**
 * Enhanced website search with LLM-based query understanding
 */
export async function searchWebsiteWithContext(
    query: string,
    searchFunction: Function,
    options?: any,
): Promise<any> {
    const websiteInstructions = createWebsiteAnswerInstructions();

    const searchOptions = {
        ...options,
        modelInstructions: [
            ...(options?.modelInstructions || []),
            ...websiteInstructions,
        ],
    };

    return await searchFunction(query, searchOptions);
}
