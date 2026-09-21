// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { SessionContext } from "@typeagent/agent-sdk";
import type { MemoryKnowledgeGraph } from "@typeagent/memory-service";
import type { BrowserActionContext } from "./browserActions.mjs";
import type {
    Entity,
    WebPageReference,
} from "./knowledge/schema/knowledgeExtraction.mjs";

export interface SearchWebMemoriesRequest {
    originalUserRequest?: string | undefined;
    query: string;
    searchScope?: "current_page" | "all_indexed" | undefined;
    url?: string | undefined;
    dateFrom?: string | undefined;
    dateTo?: string | undefined;
    domain?: string | undefined;
    pageType?: string | undefined;
    source?: string | undefined;
    limit?: number | undefined;
    minScore?: number | undefined;
    exactMatch?: boolean | undefined;
    generateAnswer?: boolean | undefined;
    includeRelatedEntities?: boolean | undefined;
    enableAdvancedSearch?: boolean | undefined;
    knowledgeTopK?: number | undefined;
    chunking?: boolean | undefined;
    fastStop?: boolean | undefined;
    combineAnswers?: boolean | undefined;
    choices?: string | undefined;
    maxCharsInBudget?: number | undefined;
    debug?: boolean | undefined;
    metadata?: any;
}

export interface SearchSummary {
    totalFound: number;
    searchTime: number;
    strategies: string[];
    confidence: number;
}

export interface SearchDebugContext {
    searchTerms: string[];
    searchStrategies: string[];
    knowledgeMatchCount: number;
    timing: {
        parsing: number;
        search: number;
        processing: number;
        total: number;
    };
    intermediateFallbacks: string[];
}

export interface WebsiteResult {
    url: string;
    title: string;
    domain: string;
    pageType: string;
    source: string;
    relevanceScore: number;
    lastVisited?: string;
    snippet?: string;
}

export interface SearchWebMemoriesResponse {
    websites: WebsiteResult[];
    summary: SearchSummary;
    answer?: string;
    answerType?: "direct" | "synthesized" | "noAnswer";
    answerSources?: WebPageReference[];
    confidence?: number;
    relatedEntities?: Entity[];
    topTopics?: string[];
    queryIntent?: "question" | "discovery" | "mixed";
    searchTerms?: string[];
    suggestedFollowups?: string[];
    debugContext?: SearchDebugContext;
}

function emptyResponse(
    message: string,
    startedAt: number,
): SearchWebMemoriesResponse {
    return {
        websites: [],
        summary: {
            totalFound: 0,
            searchTime: Date.now() - startedAt,
            strategies: ["durable-memory"],
            confidence: 0,
        },
        answer: message,
        answerType: "noAnswer",
        answerSources: [],
        queryIntent: "discovery",
        suggestedFollowups: [],
    };
}

function sourceMetadata(
    metadata: Record<string, unknown> | undefined,
    name: string,
): string | undefined {
    const value = metadata?.[name];
    return typeof value === "string" ? value : undefined;
}

async function searchDurable(
    request: SearchWebMemoriesRequest,
    context: SessionContext<BrowserActionContext>,
    sourceIds?: string[],
): Promise<SearchWebMemoriesResponse> {
    const startedAt = Date.now();
    const memory = context.agentContext.browserMemoryService;
    if (memory === undefined) {
        return emptyResponse(
            "Durable browser memory is not available",
            startedAt,
        );
    }
    const query = request.query.trim();
    if (query.length === 0) {
        return emptyResponse("Query cannot be empty", startedAt);
    }

    try {
        const matches = await memory.search({
            query,
            limit: request.limit ?? 20,
            ...(request.searchScope === "current_page" && request.url
                ? { url: request.url }
                : {}),
            ...(request.domain === undefined ? {} : { domain: request.domain }),
            ...(request.pageType === undefined
                ? {}
                : { pageType: request.pageType }),
            ...(request.source === undefined ? {} : { source: request.source }),
            ...(request.dateFrom === undefined
                ? {}
                : { dateFrom: request.dateFrom }),
            ...(request.dateTo === undefined ? {} : { dateTo: request.dateTo }),
            ...(sourceIds === undefined ? {} : { sourceIds }),
        });
        const websites: WebsiteResult[] = matches.map(
            ({ evidence, source }) => {
                let domain = sourceMetadata(source.metadata, "domain");
                if (domain === undefined && source.canonicalUri !== undefined) {
                    try {
                        domain = new URL(source.canonicalUri).hostname;
                    } catch {
                        domain = "unknown";
                    }
                }
                return {
                    url: source.canonicalUri ?? "",
                    title: source.title,
                    domain: domain ?? "unknown",
                    pageType:
                        sourceMetadata(source.metadata, "pageType") ??
                        "webpage",
                    source:
                        sourceMetadata(source.metadata, "source") ?? "memory",
                    relevanceScore: evidence.score,
                    ...(evidence.capturedAt === undefined
                        ? {}
                        : { lastVisited: evidence.capturedAt }),
                    snippet: evidence.snippet,
                };
            },
        );
        const debugContext: SearchDebugContext | undefined = request.debug
            ? {
                  searchTerms: [query],
                  searchStrategies: ["durable-memory"],
                  knowledgeMatchCount: websites.length,
                  timing: {
                      parsing: 0,
                      search: Date.now() - startedAt,
                      processing: 0,
                      total: Date.now() - startedAt,
                  },
                  intermediateFallbacks: [],
              }
            : undefined;
        return {
            websites,
            summary: {
                totalFound: websites.length,
                searchTime: Date.now() - startedAt,
                strategies: ["durable-memory"],
                confidence:
                    websites.length === 0
                        ? 0
                        : Math.max(
                              ...websites.map((site) => site.relevanceScore),
                          ),
            },
            answer:
                websites.length === 0
                    ? `No indexed websites matched "${query}".`
                    : `Found ${websites.length} indexed website${websites.length === 1 ? "" : "s"}.`,
            answerType: websites.length === 0 ? "noAnswer" : "direct",
            answerSources: matches.map(({ evidence, source }) => ({
                url: source.canonicalUri ?? "",
                title: source.title,
                relevanceScore: evidence.score,
                lastIndexed: evidence.indexedAt,
            })),
            queryIntent: "discovery",
            searchTerms: [query],
            suggestedFollowups: [],
            ...(debugContext === undefined ? {} : { debugContext }),
        };
    } catch (error) {
        return emptyResponse(
            error instanceof Error ? error.message : "Durable search failed",
            startedAt,
        );
    }
}

function matchingSourceIds(
    names: string[],
    graph: MemoryKnowledgeGraph,
    kind: "entity" | "topic",
): string[] {
    const requested = new Set(names.map((name) => name.toLocaleLowerCase()));
    const matches = kind === "entity" ? graph.entities : graph.topics;
    return [
        ...new Set(
            matches
                .filter((item) => requested.has(item.name.toLocaleLowerCase()))
                .flatMap((item) => item.sourceIds),
        ),
    ];
}

export function searchWebMemories(
    request: SearchWebMemoriesRequest,
    context: SessionContext<BrowserActionContext>,
): Promise<SearchWebMemoriesResponse> {
    return searchDurable(request, context);
}

export async function searchByEntities(
    request: {
        entities: string[];
        url?: string;
        maxResults?: number;
        searchScope?: "current_page" | "all_indexed";
        includeMetadata?: boolean;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<SearchWebMemoriesResponse> {
    const memory = context.agentContext.browserMemoryService;
    if (memory === undefined) {
        return emptyResponse(
            "Durable browser memory is not available",
            Date.now(),
        );
    }
    const sourceIds = matchingSourceIds(
        request.entities,
        await memory.getKnowledgeGraph(),
        "entity",
    );
    if (sourceIds.length === 0) {
        return emptyResponse(
            `No websites found containing entities: ${request.entities.join(", ")}`,
            Date.now(),
        );
    }
    return searchDurable(
        {
            query: request.entities.join(" OR "),
            url: request.url,
            searchScope: request.searchScope,
            limit: request.maxResults,
            generateAnswer: false,
        },
        context,
        sourceIds,
    );
}

export async function searchByTopics(
    request: {
        topics: string[];
        url?: string;
        maxResults?: number;
        searchScope?: "current_page" | "all_indexed";
        includeMetadata?: boolean;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<SearchWebMemoriesResponse> {
    const memory = context.agentContext.browserMemoryService;
    if (memory === undefined) {
        return emptyResponse(
            "Durable browser memory is not available",
            Date.now(),
        );
    }
    const sourceIds = matchingSourceIds(
        request.topics,
        await memory.getKnowledgeGraph(),
        "topic",
    );
    if (sourceIds.length === 0) {
        return emptyResponse(
            `No websites found containing topics: ${request.topics.join(", ")}`,
            Date.now(),
        );
    }
    return searchDurable(
        {
            query: request.topics.join(" OR "),
            url: request.url,
            searchScope: request.searchScope,
            limit: request.maxResults,
            generateAnswer: false,
        },
        context,
        sourceIds,
    );
}

export function hybridSearch(
    request: {
        query: string;
        url?: string;
        maxResults?: number;
        searchScope?: "current_page" | "all_indexed";
        includeMetadata?: boolean;
        combineStrategies?: boolean;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<SearchWebMemoriesResponse> {
    return searchDurable(
        {
            query: request.query,
            url: request.url,
            searchScope: request.searchScope,
            limit: request.maxResults,
            generateAnswer: false,
        },
        context,
    );
}

export function generateWebSearchMarkdown(
    searchResponse: SearchWebMemoriesResponse,
    _query?: string,
): string {
    let content = `Found ${searchResponse.websites.length} result(s) in ${searchResponse.summary.searchTime}ms\n\n`;
    if (searchResponse.answer && searchResponse.answerType !== "noAnswer") {
        content += `**Answer:** ${searchResponse.answer}\n\n`;
    }
    if (searchResponse.websites.length > 0) {
        content += "**Top Results:**\n\n";
        searchResponse.websites.slice(0, 10).forEach((site, index) => {
            content += `${index + 1}. ${site.title}\n([link](${site.url}))`;
            if (site.lastVisited) {
                content += ` - Last visited: ${new Date(site.lastVisited).toLocaleDateString()}`;
            }
            content += "\n\n";
        });
    }
    if (searchResponse.relatedEntities?.length) {
        content += `**Related Entities:**\n\n${searchResponse.relatedEntities
            .slice(0, 5)
            .map((entity) => `- ${entity.name}`)
            .join("\n")}\n\n`;
    }
    if (searchResponse.topTopics?.length) {
        content += `**Top Topics:**\n\n${searchResponse.topTopics
            .slice(0, 5)
            .map((topic) => `- ${topic}`)
            .join("\n")}\n\n`;
    }
    if (searchResponse.suggestedFollowups?.length) {
        content += `**Suggested Follow-ups:**\n\n${searchResponse.suggestedFollowups
            .map((followup) => `- ${followup}`)
            .join("\n")}\n`;
    }
    return content;
}
