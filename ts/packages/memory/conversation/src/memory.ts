// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai } from "aiclient";
import * as kp from "knowpro";
import {
    conversation as kpLib,
    TextEmbeddingModelWithCache,
    TextEmbeddingCache,
} from "knowledge-processor";
import * as ms from "memory-storage";
import { PromptSection, Result, TypeChatLanguageModel } from "typechat";
import { createEmbeddingModelWithCache } from "./common.js";

export interface MemorySettings {
    languageModel: TypeChatLanguageModel;
    embeddingModel: TextEmbeddingModelWithCache;
    embeddingSize: number;
    conversationSettings: kp.ConversationSettings;
    queryTranslator?: kp.SearchQueryTranslator | undefined;
    fileSaveSettings?: IndexFileSettings | undefined;
}

export function createMemorySettings(
    getPersistentCache?: () => TextEmbeddingCache | undefined,
    embeddingCacheSize = 64,
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

export class Message<TMeta extends MessageMetadata = MessageMetadata>
    implements kp.IMessage
{
    public textChunks: string[];

    constructor(
        public metadata: TMeta,
        messageBody: string | string[],
        public tags: string[] = [],
        public timestamp: string | undefined = undefined,
        public knowledge: kpLib.KnowledgeResponse | undefined,
        public deletionInfo: kp.DeletionInfo | undefined = undefined,
    ) {
        if (Array.isArray(messageBody)) {
            this.textChunks = messageBody;
        } else {
            this.textChunks = [messageBody];
        }
    }

    public addContent(content: string, chunkOrdinal = 0) {
        if (chunkOrdinal > this.textChunks.length) {
            this.textChunks.push(content);
        } else {
            this.textChunks[chunkOrdinal] += content;
        }
    }

    public addKnowledge(
        newKnowledge: kpLib.KnowledgeResponse,
    ): kpLib.KnowledgeResponse {
        if (this.knowledge !== undefined) {
            this.knowledge.entities = kp.mergeConcreteEntities([
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
        combinedKnowledge.actions.push(...metaKnowledge.actions);
        combinedKnowledge.inverseActions.push(...metaKnowledge.inverseActions);
        combinedKnowledge.topics.push(...metaKnowledge.topics);
        return combinedKnowledge;
    }
}

//
// TODO: common, boiler plate and other common memory methods go here
//
export abstract class Memory<
    TSettings extends MemorySettings = MemorySettings,
    TMessage extends Message = Message,
> {
    constructor() {}

    public abstract get settings(): TSettings;
    public abstract get conversation(): kp.IConversation<TMessage>;

    /**
     * Run a natural language query against this memory
     * @param searchText
     * @returns
     */
    public async search(
        searchText: string,
        options?: kp.LanguageSearchOptions,
    ): Promise<Result<kp.ConversationSearchResult[]>> {
        options = this.adjustLanguageSearchOptions(options);
        return kp.searchConversationWithLanguage(
            this.conversation,
            searchText,
            this.getQueryTranslator(),
            options,
        );
    }

    public async searchQueryFromLanguage(
        searchText: string,
        options?: kp.LanguageSearchOptions,
    ): Promise<Result<kp.querySchema.SearchQuery>> {
        options = this.adjustLanguageSearchOptions(options);
        return kp.searchQueryFromLanguage(
            this.conversation,
            this.getQueryTranslator(),
            searchText,
            this.getSearchInstructions(),
        );
    }

    protected getSearchInstructions(): PromptSection[] | undefined {
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
        options ??= kp.createLanguageSearchOptions();
        const instructions = this.getSearchInstructions();
        if (instructions) {
            if (options.modelInstructions) {
                options.modelInstructions.push(...instructions);
            } else {
                options.modelInstructions = instructions;
            }
        }
        return options;
    }
}
