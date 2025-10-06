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
import {
    AggregateTopicResponse,
    HierarchicalTopicResponse,
} from "./aggregateTopicSchema.js";
import { TextIndex, TextIndexSettings } from "../textIndex.js";
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
    unionMultiple,
    uniqueFrom,
} from "../setOperations.js";
import { createRecentItemsWindow } from "../temporal.js";
import { TermFilter } from "./knowledgeTermSearchSchema.js";
import { TermFilterV2 } from "./knowledgeTermSearchSchema2.js";
import {
    getAllTermsInFilter,
    getSubjectFromActionTerm,
} from "./knowledgeTermSearch2.js";
import {
    createFileSystemStorageProvider,
    StorageProvider,
    ValueDataType,
    ValueType,
} from "../storageProvider.js";
import { KeyValueIndex } from "../keyValueIndex.js";
import { isValidEntityName } from "./knowledge.js";
import { EntityNameIndex } from "./entities.js";

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
    buildHierarchy(
        topics: Topic[],
        existingRoots?: string[],
    ): Promise<HierarchicalTopicResponse | undefined>;
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
    const hierarchicalTranslator = createTranslator<HierarchicalTopicResponse>(
        mergeModel,
        loadSchema(["aggregateTopicSchema.ts"], import.meta.url),
        "HierarchicalTopicResponse",
    );
    return {
        nextTopic,
        mergeTopics,
        buildHierarchy,
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

    async function buildHierarchy(
        topics: Topic[],
        existingRoots?: string[],
    ): Promise<HierarchicalTopicResponse | undefined> {
        let instruction = `Analyze the topics in [TOPIC SECTION] and organize them into a hierarchical structure.

RULES:
1. Create 3-7 root topics that represent distinct semantic domains
2. Root topics must be 1-3 words, concise and clear
3. Group related sub-topics under appropriate roots
4. Create intermediate levels (2-4 levels deep) when topics naturally nest
5. NEVER combine unrelated domains under the same root
6. Use only the provided information. Make no assumptions about the origin of the topics.
`;

        if (existingRoots && existingRoots.length > 0) {
            instruction += `\nEXISTING ROOTS:\n${existingRoots.join("\n")}\n`;
            instruction += `Reuse existing roots when topics fit semantically. Only create new roots when topics represent genuinely new domains.\n`;
        }

        let request = instruction + "\n\n";
        request += makeSection(
            "TOPIC SECTION",
            topics.join("\n"),
            "END SECTION",
        );
        request += "\n\n";

        const result = await hierarchicalTranslator.translate(request);
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
                await topicIndex.addNext(
                    [aggregateTopic.value],
                    aggregateTopic.timestamp,
                );
                await topicIndex.add(aggregateTopic.value);
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
    sourceNameSearchOptions?: SearchOptions;
    loadTopics?: boolean | undefined;
    useHighLevel?: boolean | undefined;
    filterBySourceName?: boolean | undefined;
}

export function createTopicSearchOptions(
    isTopicSummary: boolean = false,
): TopicSearchOptions {
    return {
        maxMatches: isTopicSummary ? Number.MAX_SAFE_INTEGER : 25,
        minScore: 0.8,
        loadTopics: true,
        sourceNameSearchOptions: {
            maxMatches: 8,
            minScore: 0.8,
        },
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
    /**
     * Add the topic to the topic index and the topic sequence with the supplied timestamp
     * @param topics
     * @param timestamp
     */
    addNext(
        topics: TextBlock<TSourceId>[],
        timestamp?: Date,
    ): Promise<TTopicId[]>;
    /**
     * Add a topic to the index, but not to the sequence
     * @param topic
     */
    add(
        topic: string | TextBlock<TSourceId>,
        sourceName?: string,
        id?: TTopicId,
    ): Promise<TTopicId>;
    addMultiple(
        text: TextBlock<TSourceId>[],
        sourceName?: string,
        ids?: TTopicId[],
    ): Promise<TTopicId[]>;
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
        possibleIds?: TTopicId[] | undefined,
    ): Promise<TopicSearchResult<TTopicId>>;
    loadSourceIds(
        sourceIdLog: TemporalLog<TSourceId>,
        results: TopicSearchResult<TTopicId>[],
        unique?: Set<TSourceId>,
    ): Promise<Set<TSourceId> | undefined>;
}

export async function createTopicIndex<TSourceId extends ValueType = string>(
    settings: TextIndexSettings,
    getNameIndex: () => Promise<EntityNameIndex<string>>,
    rootPath: string,
    name: string,
    sourceIdType: ValueDataType<TSourceId>,
    folderSettings?: ObjectFolderSettings,
    fSys?: FileSystem,
): Promise<TopicIndex<string, TSourceId>> {
    return createTopicIndexOnStorage<TSourceId>(
        settings,
        getNameIndex,
        rootPath,
        name,
        createFileSystemStorageProvider(rootPath, folderSettings, fSys),
        sourceIdType,
    );
}

export async function createTopicIndexOnStorage<
    TSourceId extends ValueType = string,
>(
    settings: TextIndexSettings,
    getNameIndex: () => Promise<EntityNameIndex<string>>,
    basePath: string,
    name: string,
    storageProvider: StorageProvider,
    sourceIdType: ValueDataType<TSourceId>,
): Promise<TopicIndex<string, TSourceId>> {
    type TopicId = string;
    // Timestamped sequence of topics, as they were seen
    const sequence = await storageProvider.createTemporalLog<TopicId[]>(
        { concurrency: settings.concurrency },
        path.join(basePath, name),
        "sequence",
    );
    const topicIndex = await storageProvider.createTextIndex<TSourceId>(
        settings,
        basePath,
        name,
        sourceIdType,
    );
    // Optionally maintain an index of the entities that that were involved in discussing
    // or formulating this topic...
    const sourceNameToTopicIndex = await storageProvider.createIndex<TopicId>(
        basePath,
        "sourceEntities",
        "TEXT",
    );
    return {
        settings,
        sequence,
        textIndex: topicIndex,
        topics,
        entries: topicIndex.entries,
        getTopicSequence,
        get,
        getText,
        getMultiple,
        getId: topicIndex.getId,
        getMultipleText,
        getSourceIds,
        getSourceIdsForTopic,
        add,
        addNext,
        addMultiple,
        search,
        searchTerms,
        searchTermsV2,
        loadSourceIds,
    };

    async function* topics(): AsyncIterableIterator<string> {
        for (const topic of topicIndex.text()) {
            yield topic;
        }
    }

    async function get(id: TopicId): Promise<TextBlock<TSourceId> | undefined> {
        const topic = await topicIndex.getText(id);
        return topic
            ? {
                  value: topic,
                  sourceIds: await topicIndex.getById(id),
                  type: TextBlockType.Sentence,
              }
            : undefined;
    }

    async function getText(id: TopicId): Promise<string> {
        return (await topicIndex.getText(id)) ?? "";
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
        const postings = removeUndefined(await topicIndex.getByIds(ids));
        return postings && postings.length > 0
            ? (uniqueFrom<TSourceId[]>(postings, (p) => p, true) as TSourceId[])
            : [];
    }

    async function getSourceIdsForTopic(
        topic: string,
    ): Promise<TSourceId[] | undefined> {
        return topicIndex.get(topic);
    }

    async function addMultiple(
        topics: TextBlock<TSourceId>[],
        sourceName?: string,
        ids?: TopicId[],
    ): Promise<TopicId[]> {
        if (ids && ids.length !== topics.length) {
            throw Error("Id length mismatch");
        }
        const topicIds: TopicId[] = [];
        for (let i = 0; i < topics.length; ++i) {
            let id = await add(topics[i], sourceName, ids ? ids[i] : undefined);
            topicIds.push(id);
        }

        return topicIds;
    }

    async function addNext(
        topics: TextBlock<TSourceId>[],
        timestamp?: Date,
    ): Promise<TopicId[]> {
        const topicIds = await asyncArray.mapAsync(topics, 1, (t) =>
            topicIndex.put(t.value),
        );
        topicIds.sort();
        await sequence.put(topicIds, timestamp);
        return topicIds;
    }

    async function add(
        topic: string | TextBlock<TSourceId>,
        sourceName?: string | undefined,
        id?: TopicId,
    ): Promise<TopicId> {
        let topicId: TopicId | undefined;
        if (typeof topic === "string") {
            topicId = id ? id : await topicIndex.put(topic);
        } else {
            if (id) {
                topicId = id;
                if (topic.sourceIds) {
                    await topicIndex.addSources(topicId, topic.sourceIds);
                }
            } else {
                topicId = await topicIndex.put(topic.value, topic.sourceIds);
            }
        }

        if (sourceName) {
            const entityNames = await getNameIndex();
            // TODO: use aliases here for better matching
            const nameId = await entityNames.nameIndex.getId(sourceName);
            if (nameId) {
                await sourceNameToTopicIndex.put([topicId], nameId);
            }
        }
        return topicId;
    }

    async function search(
        filter: TopicFilter,
        options: TopicSearchOptions,
        sourceName?: string,
        rawTerms?: string[] | undefined,
        possibleIds?: TopicId[] | undefined,
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
                results.topicIds = await asyncArray.toArray(topicIndex.ids());
            } else {
                results.topicIds = rawTerms
                    ? await topicIndex.getNearestTextMultiple(
                          rawTerms,
                          options.maxMatches,
                          options.minScore,
                      )
                    : await topicIndex.getNearestText(
                          filter.topics,
                          options.maxMatches,
                          options.minScore,
                      );
            }
            if (results.topicIds && results.topicIds.length === 0) {
                results.topicIds = undefined;
            }
            if (results.topicIds) {
                if (possibleIds && possibleIds.length > 0) {
                    // TODO: combine this and the one below
                    results.topicIds = [
                        ...intersect(results.topicIds, possibleIds),
                    ];
                }
                if (sourceName) {
                    const entityNames = await getNameIndex();
                    const topicIdsWithSource = await matchName(
                        entityNames,
                        sourceNameToTopicIndex,
                        sourceName,
                        options,
                    );
                    if (topicIdsWithSource) {
                        results.topicIds = [
                            ...intersect(results.topicIds, topicIdsWithSource),
                        ];
                    }
                }
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
        possibleIds?: TopicId[] | undefined,
    ): Promise<TopicSearchResult<TopicId>> {
        // We will just use the standard topic stuff for now, since that does the same thing
        const allTerms = getAllTermsInFilter(filter);
        let sourceName = getSubjectFromActionTerm(filter.action);
        if (!isValidEntityName(sourceName)) {
            sourceName = undefined;
        }
        const topics =
            allTerms && allTerms.length > 0 ? allTerms.join(" ") : "*";
        const topicFilter: TopicFilter = {
            filterType: "Topic",
            topics,
            timeRange: filter.timeRange,
        };
        return search(
            topicFilter,
            options,
            options.filterBySourceName ? sourceName : undefined,
            //topics !== "*" ? getAllTermsInFilter(filter, false) : undefined,
            undefined,
            possibleIds,
        );
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

    async function matchName(
        names: EntityNameIndex<string>,
        nameIndex: KeyValueIndex<string, TopicId>,
        name: string | undefined,
        searchOptions: TopicSearchOptions,
    ): Promise<IterableIterator<TopicId> | undefined> {
        const options = searchOptions.sourceNameSearchOptions ?? searchOptions;
        // Possible names of entities
        const nameIds = await names.nameIndex.getNearestText(
            name!,
            options.maxMatches,
            options.minScore,
            names.nameAliases,
        );
        if (nameIds && nameIds.length > 0) {
            // Load all topic Ids for those entities
            const matches = await nameIndex.getMultiple(
                nameIds,
                settings.concurrency,
            );
            if (matches && matches.length > 0) {
                return unionMultiple(...matches);
            }
        }
        return undefined;
    }
}
