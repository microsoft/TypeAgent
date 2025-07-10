// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel, openai } from "aiclient";
import * as kp from "knowpro";
import {
    conversation as kpLib,
    TextEmbeddingModelWithCache,
    TextEmbeddingCache,
} from "knowledge-processor";
import * as ms from "memory-storage";
import { error, PromptSection, Result, success } from "typechat";
import { createEmbeddingModelWithCache } from "./common.js";

export interface MemorySettings {
    languageModel: ChatModel;
    embeddingModel: TextEmbeddingModelWithCache;
    embeddingSize: number;
    conversationSettings: kp.ConversationSettings;
    queryTranslator?: kp.SearchQueryTranslator | undefined;
    answerGenerator?: kp.IAnswerGenerator | undefined;
    fileSaveSettings?: IndexFileSettings | undefined;
}

export function createMemorySettings(
    embeddingCacheSize = 64,
    getPersistentCache?: () => TextEmbeddingCache | undefined,
): MemorySettings {
    const languageModel = openai.createChatModelDefault("conversation-memory");
    /**
     * Our index already has embeddings for every term in the podcast
     * Create a caching embedding model that can just leverage those embeddings
     * @returns embedding model, size of embedding
     */
    const [embeddingModel, embeddingSize] = createEmbeddingModelWithCache(
        embeddingCacheSize,
        getPersistentCache,
    );

    const conversationSettings = kp.createConversationSettings(
        embeddingModel,
        embeddingSize,
    );
    conversationSettings.semanticRefIndexSettings.knowledgeExtractor =
        kp.createKnowledgeExtractor(languageModel);

    const queryTranslator = kp.createSearchQueryTranslator(languageModel);
    const memorySettings: MemorySettings = {
        languageModel,
        embeddingModel,
        embeddingSize,
        conversationSettings,
        queryTranslator,
    };
    return memorySettings;
}

export type IndexFileSettings = {
    dirPath: string;
    baseFileName: string;
};

export type IndexingState = {
    lastMessageOrdinal: kp.MessageOrdinal;
    lastSemanticRefOrdinal: kp.SemanticRefOrdinal;
};

export type TermSynonyms = {
    term: string;
    relatedTerms: string[];
};

export function addSynonymsAsAliases(
    aliases: kp.TermToRelatedTermsMap,
    synonyms: TermSynonyms[],
): void {
    for (const ts of synonyms) {
        let relatedTerm: kp.Term = { text: ts.term.toLowerCase() };
        for (const synonym of ts.relatedTerms) {
            aliases.addRelatedTerm(synonym.toLowerCase(), relatedTerm);
        }
    }
}

export function addSynonymsFileAsAliases(
    aliases: kp.TermToRelatedTermsMap,
    filePath: string,
) {
    const synonyms = ms.readJsonFile<TermSynonyms[]>(filePath);
    if (synonyms && synonyms.length > 0) {
        addSynonymsAsAliases(aliases, synonyms);
    }
}

export function addNoiseWordsFromFile(
    noise: Set<string>,
    filePath: string,
): void {
    const words = ms.readAllLines(filePath);
    if (words) {
        words.forEach((word) => noise.add(word));
    }
}

export class MessageMetadata
    implements kp.IMessageMetadata, kp.IKnowledgeSource
{
    public get source(): string | string[] | undefined {
        return undefined;
    }
    public get dest(): string | string[] | undefined {
        return undefined;
    }

    public getKnowledge(): kpLib.KnowledgeResponse | undefined {
        return undefined;
    }
}

/**
 * A Message in a Memory {@link Memory}
 */
export class Message<TMeta extends MessageMetadata = MessageMetadata>
    implements kp.IMessage
{
    public textChunks: string[];

    constructor(
        public metadata: TMeta,
        messageBody: string | string[],
        public tags: string[] = [],
        public timestamp: string | undefined = undefined,
        public knowledge: kpLib.KnowledgeResponse | undefined = undefined,
        public deletionInfo: kp.DeletionInfo | undefined = undefined,
    ) {
        if (Array.isArray(messageBody)) {
            this.textChunks = messageBody;
        } else {
            this.textChunks = [messageBody];
        }
    }

    public addContent(content: string, chunkOrdinal = 0) {
        if (
            chunkOrdinal > this.textChunks.length - 1 ||
            this.textChunks.length == 0
        ) {
            this.textChunks.push(content);
        } else {
            this.textChunks[chunkOrdinal] += content;
        }
    }

    public addKnowledge(
        newKnowledge: kpLib.KnowledgeResponse,
    ): kpLib.KnowledgeResponse {
        if (this.knowledge !== undefined) {
            this.knowledge.entities = this.mergeEntities([
                ...this.knowledge.entities,
                ...newKnowledge.entities,
            ]);
            this.knowledge.topics = kp.mergeTopics([
                ...this.knowledge.topics,
                ...newKnowledge.topics,
            ]);
            this.knowledge.actions.push(...newKnowledge.actions);
            this.knowledge.inverseActions.push(...newKnowledge.inverseActions);
        } else {
            this.knowledge = newKnowledge;
        }
        return this.knowledge;
    }

    getKnowledge(): kpLib.KnowledgeResponse | undefined {
        let metaKnowledge = this.metadata.getKnowledge();
        if (!metaKnowledge) {
            return this.knowledge;
        }
        if (!this.knowledge) {
            return metaKnowledge;
        }
        const combinedKnowledge: kpLib.KnowledgeResponse = {
            ...this.knowledge,
        };
        combinedKnowledge.entities.push(...metaKnowledge.entities);
        combinedKnowledge.entities = this.mergeEntities(
            combinedKnowledge.entities,
        );
        combinedKnowledge.topics.push(...metaKnowledge.topics);
        combinedKnowledge.topics = kp.mergeTopics(combinedKnowledge.topics);

        combinedKnowledge.actions.push(...metaKnowledge.actions);
        combinedKnowledge.inverseActions.push(...metaKnowledge.inverseActions);
        return combinedKnowledge;
    }

    private mergeEntities(
        entities: kpLib.ConcreteEntity[],
    ): kpLib.ConcreteEntity[] {
        // TODO: using mergeConcreteEntitiesEx to avoid forcing the data to be lower case.
        // Replace with mergeConcreteEntities once it has switch over to the Ex version.
        return kp.mergeConcreteEntitiesEx(entities);
    }
}

/**
 * A memory containing a sequence of messages {@link Message}
 * Memory is modeled as a conversation {@link kp.IConversation}
 */
export abstract class Memory<
    TSettings extends MemorySettings = MemorySettings,
    TMessage extends Message = Message,
> {
    public nameTag: string;
    public tags: string[];
    public settings: TSettings;
    public noiseTerms: Set<string>;

    constructor(settings: TSettings, nameTag?: string, tags?: string[]) {
        this.settings = settings;
        this.nameTag = nameTag ?? "";
        this.tags = tags ?? [];
        this.noiseTerms = new Set<string>();
        this.settings.queryTranslator ??= kp.createSearchQueryTranslator(
            this.settings.languageModel,
        );
        this.settings.embeddingModel.getPersistentCache = () =>
            this.getPersistentEmbeddingCache();

        this.addStandardNoiseTerms();
    }

    /**
     * The conversation representing this memory
     */
    public abstract get conversation(): kp.IConversation<TMessage>;

    /**
     * Search memory using a select expression. Searches for and returns both conversation knowledge and messages
     * @param {kp.SearchSelectExpr} selectExpr - The select expression to use for searching.
     * @returns {Promise<kp.ConversationSearchResult | undefined>} - The search result or undefined if not found.
     */
    public async search(
        selectExpr: kp.SearchSelectExpr,
        options?: kp.SearchOptions,
    ): Promise<kp.ConversationSearchResult | undefined> {
        return kp.searchConversation(
            this.conversation,
            selectExpr.searchTermGroup,
            selectExpr.when,
            options,
        );
    }

    /**
     * Search knowledge extracted from this conversation
     * @param selectExpr
     * @param options
     * @returns {Promise<Map<kp.KnowledgeType, kp.SemanticRefSearchResult> | undefined>} - knowledge matches or undefined if none
     */
    public async searchKnowledge(
        selectExpr: kp.SearchSelectExpr,
        options?: kp.SearchOptions,
    ): Promise<Map<kp.KnowledgeType, kp.SemanticRefSearchResult> | undefined> {
        return kp.searchConversationKnowledge(
            this.conversation,
            selectExpr.searchTermGroup,
            selectExpr.when,
            options,
        );
    }

    /***
     * Run a natural language query against this memory.
     * @param {string} searchText - The natural language query text.
     * @param {kp.LanguageSearchOptions} [options] - Optional search options.
     * @param {kp.LanguageSearchDebugContext} [debugContext] - Optional debug context.
     * @returns {Promise<Result<kp.ConversationSearchResult[]>>} - The search results.
     */
    public async searchWithLanguage(
        searchText: string,
        options?: kp.LanguageSearchOptions,
        langSearchFilter?: kp.LanguageSearchFilter,
        debugContext?: kp.LanguageSearchDebugContext,
    ): Promise<Result<kp.ConversationSearchResult[]>> {
        options = this.adjustLanguageSearchOptions(options);
        return kp.searchConversationWithLanguage(
            this.conversation,
            searchText,
            this.getQueryTranslator(),
            options,
            langSearchFilter,
            debugContext,
        );
    }

    /**
     * Translate a natural language query into a query expression.
     * @param {string} searchText - The natural language query text.
     * @param {kp.LanguageSearchOptions} [options] - Optional search options.
     * @returns {Promise<Result<kp.querySchema.SearchQuery>>} - The translated query expression.
     */
    public async searchQueryFromLanguage(
        searchText: string,
        options?: kp.LanguageSearchOptions,
    ): Promise<Result<kp.querySchema.SearchQuery>> {
        options = this.adjustLanguageSearchOptions(options);
        return kp.searchQueryFromLanguage(
            this.conversation,
            this.getQueryTranslator(),
            searchText,
            this.getModelInstructions(),
        );
    }

    /**
     * Get an answer from a natural language question.
     * @param {string} question - The natural language question.
     * @param {kp.LanguageSearchOptions} [searchOptions] - Optional search options.
     * @param progress - Optional progress callback.
     * @returns {Promise<Result<[kp.ConversationSearchResult, kp.AnswerResponse][]>>} - Search Results and the answers generated for them.
     */
    public async getAnswerFromLanguage(
        question: string,
        searchOptions?: kp.LanguageSearchOptions,
        langSearchFilter?: kp.LanguageSearchFilter,
        progress?: (
            searchResult: kp.ConversationSearchResult,
            chunk: kp.AnswerContext,
            index: number,
            result: Result<kp.AnswerResponse>,
        ) => void,
        answerContextOptions?: kp.AnswerContextOptions,
    ): Promise<Result<[kp.ConversationSearchResult, kp.AnswerResponse][]>> {
        const searchResults = await this.searchWithLanguage(
            question,
            searchOptions,
            langSearchFilter,
        );
        if (!searchResults.success) {
            return searchResults;
        }

        const answers: [kp.ConversationSearchResult, kp.AnswerResponse][] = [];
        for (let i = 0; i < searchResults.data.length; ++i) {
            const searchResult = searchResults.data[i];
            const answerResult = await this.getAnswerFromSearchResults(
                searchResult,
                searchResult.rawSearchQuery,
                progress !== undefined
                    ? (chunk, index, result) => {
                          progress(searchResult, chunk, index, result);
                      }
                    : undefined,
                answerContextOptions,
            );
            if (!answerResult.success) {
                return answerResult;
            }
            answers.push([searchResult, answerResult.data]);
        }

        return success(answers);
    }

    /**
     * Get an answer from search results.
     * @param {kp.ConversationSearchResult} searchResult - The search result.
     * @param {string} [question] - Optional question text.
     * @param progress - Optional progress callback.
     * @returns {Promise<Result<kp.AnswerResponse>>} - The answer response.
     */
    public async getAnswerFromSearchResults(
        searchResult: kp.ConversationSearchResult,
        question?: string,
        progress?: (
            chunk: kp.AnswerContext,
            index: number,
            result: Result<kp.AnswerResponse>,
        ) => void,
        answerContextOptions?: kp.AnswerContextOptions,
    ): Promise<Result<kp.AnswerResponse>> {
        question ??= searchResult.rawSearchQuery;
        if (!question) {
            return error("No searchResult.rawSearchQuery or question provided");
        }
        const answerGenerator = this.ensureAnswerGenerator();
        return kp.generateAnswer(
            this.conversation,
            answerGenerator,
            question,
            searchResult,
            progress,
            answerContextOptions,
        );
    }

    protected beginIndexing(): void {
        // Turn off caching during indexing because:
        // - LRU caches will not be useful
        // - Any persistent caches will be rebuilt anyway
        this.settings.embeddingModel.cacheEnabled = false;
    }

    protected endIndexing(): void {
        // See note in beginIndexing for why this was turned off during indexing
        this.settings.embeddingModel.cacheEnabled = true;
    }

    public getModelInstructions(): PromptSection[] | undefined {
        return undefined;
    }

    protected getPersistentEmbeddingCache(): TextEmbeddingCache | undefined {
        return undefined;
    }

    private getQueryTranslator(): kp.SearchQueryTranslator {
        const queryTranslator = this.settings.queryTranslator;
        if (!queryTranslator) {
            throw new Error("No query translator provided");
        }
        return queryTranslator;
    }

    private adjustLanguageSearchOptions(options?: kp.LanguageSearchOptions) {
        options ??= kp.createLanguageSearchOptionsTypical();
        const instructions = this.getModelInstructions();
        if (instructions) {
            if (options.modelInstructions) {
                options.modelInstructions.push(...instructions);
            } else {
                options.modelInstructions = instructions;
            }
        }
        options.compileOptions.termFilter = (t) =>
            !this.noiseTerms.has(t.toLowerCase());
        return options;
    }

    protected addStandardNoiseTerms() {
        addNoiseWordsFromFile(
            this.noiseTerms,
            ms.getAbsolutePathFromUrl(import.meta.url, "noiseTerms.txt"),
        );
    }

    protected ensureAnswerGenerator(): kp.IAnswerGenerator {
        if (this.settings.answerGenerator === undefined) {
            this.settings.answerGenerator = new kp.AnswerGenerator(
                kp.createAnswerGeneratorSettings(this.settings.languageModel),
            );
        }
        return this.settings.answerGenerator;
    }
}
