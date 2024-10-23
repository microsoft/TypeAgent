// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    FileSystem,
    ObjectFolderSettings,
    SearchOptions,
    asyncArray,
    dateTime,
    loadSchema,
} from "typeagent";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { Topic, TopicResponse } from "./topicSchema.js";
import {
    TypeChatJsonTranslator,
    TypeChatLanguageModel,
    createJsonTranslator,
} from "typechat";
import { AggregateTopicResponse } from "./aggregateTopicSchema.js";
import {
    TextIndex,
    TextIndexSettings,
    createTextIndex,
} from "../knowledgeIndex.js";
import path from "path";
import {
    SourceTextBlock,
    TextBlock,
    TextBlockType,
    collectBlockText,
    collectSourceIds,
} from "../text.js";
import { TopicFilter } from "./knowledgeSearchSchema.js";
import {
    TemporalLog,
    createTemporalLog,
    filterTemporalSequence,
    getRangeOfTemporalSequence,
    itemsFromTemporalSequence,
} from "../temporal.js";
import { toStopDate, toStartDate } from "./knowledgeActions.js";
import {
    addToSet,
    flatten,
    intersect,
    intersectMultiple,
    removeUndefined,
    uniqueFrom,
} from "../setOperations.js";
import { createRecentItemsWindow } from "./conversation.js";
import { TermFilter } from "./knowledgeTermSearchSchema.js";
import { TermFilterV2 } from "./knowledgeTermSearchSchema2.js";
import { getAllTermsInFilter } from "./searchProcessor.js";

export interface TopicExtractor {
    nextTopic(
        latestText: string,
        pastText: string,
        pastTopics?: Topic[],
        facets?: string,
    ): Promise<TopicResponse | undefined>;
    mergeTopics(
        topics: Topic[],
        pastTopics?: Topic[] | undefined,
    ): Promise<AggregateTopicResponse | undefined>;
}

export function createTopicExtractor(
    topicModel: TypeChatLanguageModel,
    mergeModel?: TypeChatLanguageModel,
): TopicExtractor {
    const defaultFacets = "comprehensive, detailed but concise, descriptive";
    mergeModel ??= topicModel;
    const topicTranslator = createTranslator<TopicResponse>(
        topicModel,
        loadSchema(["topicSchema.ts"], import.meta.url),
        "TopicResponse",
    );
    const aggregateTranslator = createTranslator<AggregateTopicResponse>(
        mergeModel,
        loadSchema(["aggregateTopicSchema.ts"], import.meta.url),
        "AggregateTopicResponse",
    );
    return {
        nextTopic,
        mergeTopics,
    };

    async function nextTopic(
        latestText: string,
        pastText: string,
        pastTopics?: Topic[],
        facets?: string,
    ): Promise<TopicResponse | undefined> {
        facets ??= defaultFacets;
        const instruction =
            "Identify all topics, themes, keywords, actions or entities mentioned, referenced ONLY in the [LATEST MESSAGE] in a conversation. " +
            "Also include the speaker, if any.\n" +
            "Prior messages are in [PAST MESSAGES]\n" +
            `Prior values identified in the conversation are in "context.pastValues". Use them when possible to avoid duplication.\n` +
            `Return ${facets} topics\n`;
        let request = "";
        request += instruction;
        request += "\n\n";
        request += buildContext(pastTopics);
        request += "\n\n";
        request += makeSection("PAST MESSAGES", pastText, "END SECTION");
        request += "\n";
        request += makeSection("LATEST MESSAGE", latestText, "END SECTION");
        request += "\n\n";
        const result = await topicTranslator.translate(request);
        return result.success ? result.data : undefined;
    }

    async function mergeTopics(
        topics: Topic[],
        pastTopics?: Topic[],
        facets?: string,
    ): Promise<AggregateTopicResponse | undefined> {
        facets ??= defaultFacets;
        let instruction = `Derive ${facets} HIGHER LEVEL topic and theme from the sub-topics found in [TOPIC SECTION]. `;
        if (pastTopics && pastTopics.length > 0) {
            instruction += `Prior topics identified in the conversation are in "context.pastValues". Use them when possible to avoid duplication.\n`;
        }
        instruction +=
            "Use only the provided information. Make no assumptions about the origin of the sub-topics.\n";
        let request = "";
        request += instruction;
        request += "\n\n";
        request += buildContext(pastTopics);
        request += "\n\n";
        request += makeSection(
            "TOPIC SECTION",
            topics.join("\n"),
            "END SECTION",
        );
        request += "\n\n";
        const result = await aggregateTranslator.translate(request);
        return result.success && result.data.status === "Success"
            ? result.data
            : undefined;
    }

    function buildContext(pastTopics?: Topic[]): string {
        const context = {
            context: {
                pastValues: pastTopics ? pastTopics : [],
            },
        };
        return JSON.stringify(context, null, 2);
    }

    function makeSection(
        startTag: string,
        text: string,
        endTag: string,
    ): string {
        return `[${startTag}]\n${text}\n[${endTag}]\n`;
    }

    function createTranslator<T extends object>(
        model: TypeChatLanguageModel,
        schema: string,
        typeName: string,
    ): TypeChatJsonTranslator<T> {
        const validator = createTypeScriptJsonValidator<T>(schema, typeName);
        const translator = createJsonTranslator<T>(model, validator);
        translator.createRequestPrompt = createRequestPrompt;
        return translator;

        function createRequestPrompt(request: string): string {
            return (
                request +
                `You return your response as a JSON object of type "${typeName}" using the following Typescript definitions:\n` +
                `\`\`\`\n${schema}\n\`\`\`\n` +
                "The following is a JSON object with 2 spaces of indentation and no properties with the value undefined:\n"
            );
        }
    }
}

export type TopicMergerSettings = {
    mergeWindowSize: number;
    trackRecent: boolean;
};

export interface TopicMerger<TTopicId = any> {
    readonly settings: TopicMergerSettings;
    /**
     * If enough prior topics to fill settings.mergeWindowSize are available then:
     *  - Merge topics into a higher level topic
     *  - Return the  merged topic
     *  - Optionally update indexes
     * @param updateIndex if true, add newly merged topic into topic index
     */
    next(
        lastTopics: TextBlock[],
        lastTopicIds: TTopicId[],
        timestamp: Date | undefined,
        updateIndex: boolean,
    ): Promise<dateTime.Timestamped<TextBlock<TTopicId>> | undefined>;
    mergeWindow(
        lastTopics: TextBlock[],
        lastTopicIds: TTopicId[],
        timestamp: Date | undefined,
        windowSize: number,
        updateIndex: boolean,
    ): Promise<dateTime.Timestamped<TextBlock<TTopicId>> | undefined>;
    clearRecent(): void;
}

export async function createTopicMerger<TTopicId = string>(
    model: TypeChatLanguageModel,
    childIndex: TopicIndex<TTopicId>,
    settings: TopicMergerSettings,
    topicIndex?: TopicIndex<TTopicId, TTopicId>,
): Promise<TopicMerger<TTopicId>> {
    const topicExtractor = createTopicExtractor(model);
    let childSize: number = await childIndex.sequence.size();
    let recentTopics = createRecentItemsWindow<Topic>(settings.mergeWindowSize);
    return {
        settings,
        next,
        mergeWindow,
        clearRecent,
    };

    async function next(
        lastTopics: TextBlock[],
        lastTopicIds: TTopicId[],
        timestamp: Date | undefined,
        updateIndex: boolean,
    ): Promise<dateTime.Timestamped<TextBlock<TTopicId>> | undefined> {
        ++childSize;
        if (childSize % settings.mergeWindowSize > 0) {
            return undefined;
        }
        return await mergeWindow(
            lastTopics,
            lastTopicIds,
            timestamp,
            settings.mergeWindowSize,
            updateIndex,
        );
    }

    async function mergeWindow(
        lastTopics: TextBlock[],
        lastTopicIds: TTopicId[],
        timestamp: Date | undefined,
        windowSize: number,
        updateIndex: boolean,
    ): Promise<dateTime.Timestamped<TextBlock<TTopicId>> | undefined> {
        const topics: Topic[] =
            windowSize === 1 ? lastTopics.map((t) => t.value) : [];
        const allTopicIds: TTopicId[] = windowSize === 1 ? lastTopicIds : [];
        if (windowSize > 1) {
            const topicWindow = await childIndex.sequence.getNewest(windowSize);
            if (topicWindow.length === 0) {
                return undefined;
            }
            timestamp = topicWindow[0].timestamp;
            for (const entry of topicWindow) {
                const topicsText = await childIndex.getMultipleText(
                    entry.value,
                );
                topics.push(topicsText.join("\n"));
                allTopicIds.push(...entry.value);
            }
        } else {
            timestamp ??= new Date();
        }
        if (topics.length === 0) {
            return undefined;
        }
        let topicsResponse = await topicExtractor.mergeTopics(
            topics,
            settings.trackRecent ? recentTopics.getUnique() : undefined,
        );
        if (!topicsResponse) {
            return undefined;
        }
        const aggregateTopic = {
            timestamp,
            value: {
                type: TextBlockType.Sentence,
                value: topicsResponse.topic,
                sourceIds: uniqueFrom(allTopicIds),
            },
        };
        if (topicIndex) {
            if (updateIndex) {
                await topicIndex.putNext(
                    [aggregateTopic.value],
                    aggregateTopic.timestamp,
                );
                await topicIndex.put(aggregateTopic.value);
            }
        }
        if (settings.trackRecent) {
            recentTopics.push(aggregateTopic.value.value);
        }

        return aggregateTopic;
    }

    function clearRecent() {
        recentTopics.reset();
    }
}

export interface TopicSearchOptions extends SearchOptions {
    loadTopics?: boolean;
}

export function createTopicSearchOptions(
    isTopicSummary: boolean = false,
): TopicSearchOptions {
    return {
        maxMatches: isTopicSummary ? Number.MAX_SAFE_INTEGER : 8,
        minScore: 0.8,
        loadTopics: true,
    };
}

export interface TopicSearchResult<TTopicId = any> {
    topicIds?: TTopicId[] | undefined;
    topics?: string[];
    temporalSequence?: dateTime.Timestamped<TTopicId[]>[] | undefined;
    getTemporalRange(): dateTime.DateRange | undefined;
}

function createSearchResults<TTopicId = any>(): TopicSearchResult<TTopicId> {
    return {
        getTemporalRange(): dateTime.DateRange | undefined {
            return getRangeOfTemporalSequence(this.temporalSequence);
        },
    };
}

export interface TopicIndex<TTopicId = any, TSourceId = any> {
    readonly settings: TextIndexSettings;
    readonly sequence: TemporalLog<TTopicId, TTopicId[]>;
    readonly textIndex: TextIndex<TTopicId, TSourceId>;

    topics(): AsyncIterableIterator<string>;
    entries(): AsyncIterableIterator<TextBlock<TSourceId>>;
    getTopicSequence(): AsyncIterableIterator<SourceTextBlock<TSourceId>>;
    get(id: TTopicId): Promise<TextBlock<TSourceId> | undefined>;
    getText(id: TTopicId): Promise<string>;
    getMultiple(ids: TTopicId[]): Promise<TextBlock<TSourceId>[]>;
    getMultipleText(ids: TTopicId[]): Promise<string[]>;
    getId(topic: string): Promise<TTopicId | undefined>;
    /**
     * Return all sources where topic was seen
     * @param topic
     */
    getSourceIds(ids: TTopicId[]): Promise<TSourceId[]>;
    getSourceIdsForTopic(topic: string): Promise<TSourceId[] | undefined>;
    put(topic: string | TextBlock<TSourceId>): Promise<TTopicId>;
    putNext(
        topics: TextBlock<TSourceId>[],
        timestamp?: Date,
    ): Promise<TTopicId[]>;
    putMultiple(text: TextBlock<TSourceId>[]): Promise<TTopicId[]>;
    search(
        filter: TopicFilter,
        options: TopicSearchOptions,
    ): Promise<TopicSearchResult<TTopicId>>;
    searchTerms(
        filter: TermFilter,
        options: TopicSearchOptions,
    ): Promise<TopicSearchResult<TTopicId>>;
    searchTermsV2(
        filter: TermFilterV2,
        options: TopicSearchOptions,
    ): Promise<TopicSearchResult<TTopicId>>;
    loadSourceIds(
        sourceIdLog: TemporalLog<TSourceId>,
        results: TopicSearchResult<TTopicId>[],
        unique?: Set<TSourceId>,
    ): Promise<Set<TSourceId> | undefined>;
}

export async function createTopicIndex<TSourceId = any>(
    settings: TextIndexSettings,
    rootPath: string,
    folderSettings?: ObjectFolderSettings,
    fSys?: FileSystem,
): Promise<TopicIndex<string, TSourceId>> {
    type TopicId = string;
    // Timestamped sequence of topics, as they were seen
    const sequence = await createTemporalLog<TopicId[]>(
        { concurrency: settings.concurrency },
        path.join(rootPath, "sequence"),
        folderSettings,
        fSys,
    );
    const textIndex = await createTextIndex<TSourceId>(
        settings,
        rootPath,
        folderSettings,
        fSys,
    );
    return {
        settings,
        sequence,
        textIndex: textIndex,
        topics,
        entries: textIndex.entries,
        getTopicSequence,
        get,
        getText,
        getMultiple,
        getId: textIndex.getId,
        getMultipleText,
        getSourceIds,
        getSourceIdsForTopic,
        put,
        putNext,
        putMultiple,
        search,
        searchTerms,
        searchTermsV2,
        loadSourceIds,
    };

    async function* topics(): AsyncIterableIterator<string> {
        for (const topic of textIndex.text()) {
            yield topic;
        }
    }

    async function get(id: TopicId): Promise<TextBlock<TSourceId> | undefined> {
        const topic = await textIndex.getText(id);
        return topic
            ? {
                  value: topic,
                  sourceIds: await textIndex.getById(id),
                  type: TextBlockType.Sentence,
              }
            : undefined;
    }

    async function getText(id: TopicId): Promise<string> {
        return (await textIndex.getText(id)) ?? "";
    }

    async function getMultiple(
        ids: TopicId[],
    ): Promise<TextBlock<TSourceId>[]> {
        const topics = await asyncArray.mapAsync(
            ids,
            settings.concurrency,
            (id) => get(id),
        );
        return removeUndefined(topics);
    }

    async function getMultipleText(ids: TopicId[]): Promise<string[]> {
        return asyncArray.mapAsync(ids, settings.concurrency, (id) =>
            getText(id),
        );
    }

    async function getSourceIds(ids: TopicId[]): Promise<TSourceId[]> {
        const postings = removeUndefined(await textIndex.getByIds(ids));
        return uniqueFrom<TSourceId[]>(postings, (p) => p, true) as TSourceId[];
    }

    async function getSourceIdsForTopic(
        topic: string,
    ): Promise<TSourceId[] | undefined> {
        return textIndex.get(topic);
    }

    async function putMultiple(
        topics: TextBlock<TSourceId>[],
    ): Promise<TopicId[]> {
        return textIndex.putMultiple(topics);
    }

    async function putNext(
        topics: TextBlock<TSourceId>[],
        timestamp?: Date,
    ): Promise<TopicId[]> {
        const topicIds = await asyncArray.mapAsync(topics, 1, (t) =>
            textIndex.put(t.value),
        );
        topicIds.sort();
        await sequence.put(topicIds, timestamp);
        return topicIds;
    }

    async function put(topic: string | TextBlock<TSourceId>): Promise<TopicId> {
        return typeof topic === "string"
            ? textIndex.put(topic)
            : textIndex.put(topic.value, topic.sourceIds);
    }

    async function search(
        filter: TopicFilter,
        options: TopicSearchOptions,
    ): Promise<TopicSearchResult<TopicId>> {
        let results = createSearchResults<TopicId>();
        if (filter.timeRange) {
            results.temporalSequence = await sequence.getEntriesInRange(
                toStartDate(filter.timeRange.startDate),
                toStopDate(filter.timeRange.stopDate),
            );
        }
        if (filter.topics) {
            if (filter.topics === "*") {
                // Wildcard
                results.topicIds = await asyncArray.toArray(textIndex.ids());
            } else {
                results.topicIds = await textIndex.getNearestText(
                    filter.topics,
                    options.maxMatches,
                    options.minScore,
                );
            }
        }

        if (results.temporalSequence) {
            const temporalTopicIds = itemsFromTemporalSequence(
                results.temporalSequence,
            );
            if (results.topicIds) {
                // Only return topics in the matched time range
                results.topicIds = [
                    ...intersectMultiple(results.topicIds, temporalTopicIds),
                ];
                results.temporalSequence = filterTemporalSequence(
                    results.temporalSequence,
                    results.topicIds,
                );
            } else {
                results.topicIds = temporalTopicIds;
            }
        }
        if (options.loadTopics) {
            if (results.topicIds) {
                results.topics = await getMultipleText(results.topicIds);
            } else if (results.temporalSequence) {
                const ids = uniqueFrom(
                    flatten(results.temporalSequence, (t) => t.value, false),
                );
                if (ids) {
                    results.topics = await getMultipleText(ids);
                }
            }
        }
        return results;
    }

    async function searchTerms(
        filter: TermFilter,
        options: TopicSearchOptions,
    ): Promise<TopicSearchResult<TopicId>> {
        // We will just use the standard topic stuff for now, since that does the same thing
        const topics =
            filter.terms && filter.terms.length > 0
                ? filter.terms.join(" ")
                : "*";
        const topicFilter: TopicFilter = {
            filterType: "Topic",
            topics,
            timeRange: filter.timeRange,
        };
        return search(topicFilter, options);
    }

    async function searchTermsV2(
        filter: TermFilterV2,
        options: TopicSearchOptions,
    ): Promise<TopicSearchResult<TopicId>> {
        // We will just use the standard topic stuff for now, since that does the same thing
        const terms = getAllTermsInFilter(filter);
        const topics = terms && terms.length > 0 ? terms.join(" ") : "*";
        const topicFilter: TopicFilter = {
            filterType: "Topic",
            topics,
            timeRange: filter.timeRange,
        };
        return search(topicFilter, options);
    }

    async function loadSourceIds(
        sourceIdLog: TemporalLog<TSourceId>,
        results: TopicSearchResult<TopicId>[],
        unique?: Set<TSourceId>,
    ): Promise<Set<TSourceId> | undefined> {
        if (results.length === 0) {
            return unique;
        }
        unique ??= new Set<TSourceId>();
        await asyncArray.forEachAsync(
            results,
            settings.concurrency,
            async (t) => {
                if (t.topicIds && t.topicIds.length > 0) {
                    const ids = await getSourceIds(t.topicIds);
                    const timeRange = t.getTemporalRange();
                    if (timeRange) {
                        const idRange = await sourceIdLog.getIdsInRange(
                            timeRange.startDate,
                            timeRange.stopDate,
                        );
                        addToSet(unique, intersect(ids, idRange));
                    } else {
                        addToSet(unique, ids);
                    }
                }
            },
        );
        return unique.size === 0 ? undefined : unique;
    }

    async function* getTopicSequence(): AsyncIterableIterator<
        SourceTextBlock<TSourceId>
    > {
        for await (const entry of sequence.all()) {
            const topicIds = entry.value.value;
            const topics = await getMultiple(topicIds);
            const block: SourceTextBlock = {
                type: TextBlockType.Paragraph,
                blockId: entry.name,
                timestamp: entry.value.timestamp,
                value: collectBlockText(topics, "\n"),
                sourceIds: collectSourceIds(topics),
            };
            yield block;
        }
    }
}
