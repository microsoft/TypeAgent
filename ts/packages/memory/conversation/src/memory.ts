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
import { TypeChatLanguageModel } from "typechat";
import { createEmbeddingModelWithCache } from "./common.js";

export type IndexFileSettings = {
    dirPath: string;
    baseFileName: string;
};

export interface MemorySettings {
    languageModel: TypeChatLanguageModel;
    embeddingModel: TextEmbeddingModelWithCache;
    embeddingSize: number;
    conversationSettings: kp.ConversationSettings;
    queryTranslator?: kp.SearchQueryTranslator | undefined;
    fileSaveSettings?: IndexFileSettings | undefined;
}

export function createMemorySettings(
    getCache: () => TextEmbeddingCache | undefined,
): MemorySettings {
    const languageModel = openai.createChatModelDefault("conversation-memory");
    /**
     * Our index already has embeddings for every term in the podcast
     * Create a caching embedding model that can just leverage those embeddings
     * @returns embedding model, size of embedding
     */
    const [embeddingModel, embeddingSize] = createEmbeddingModelWithCache(
        64,
        getCache,
    );
    const conversationSettings = kp.createConversationSettings(
        embeddingModel,
        embeddingSize,
    );
    conversationSettings.semanticRefIndexSettings.knowledgeExtractor =
        kp.createKnowledgeExtractor(languageModel);

    const memorySettings: MemorySettings = {
        embeddingModel,
        embeddingSize,
        conversationSettings,
        languageModel,
    };
    return memorySettings;
}

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
    source?: string | string[] | undefined;
    dest?: string | string[] | undefined;

    public getKnowledge(): kpLib.KnowledgeResponse | undefined {
        return undefined;
    }
}

export class Message<TMeta extends MessageMetadata = MessageMetadata>
    implements kp.IMessage
{
    constructor(
        public metadata: MessageMetadata,
        public textChunks: string[],
        public tags: string[] = [],
        public timestamp: string | undefined = undefined,
        public knowledge: kpLib.KnowledgeResponse | undefined,
        deletionInfo: kp.DeletionInfo | undefined = undefined,
    ) {}

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

export class Memory {
    constructor() {}
}
