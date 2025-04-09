// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IKnowledgeSource,
    IMessage,
    IConversation,
    ConversationSettings,
    ConversationIndex,
    SemanticRef,
    createConversationSettings,
    IndexingEventHandlers,
    IndexingResults,
    buildConversationIndex,
    SecondaryIndexingResults,
    buildSecondaryIndexes,
    ConversationThreads,
    MessageTextIndex,
    writeConversationDataToFile,
    readConversationDataFromFile,
    buildTransientSecondaryIndexes,
    Term,
    ConversationSecondaryIndexes,
    IConversationDataWithIndexes,
} from "knowpro";
import {
    conversation as kpLib,
    TextEmbeddingModelWithCache,
} from "knowledge-processor";
import { collections } from "typeagent";
import { createEmbeddingModel } from "./common.js";

import registerDebug from "debug";
const debugLogger = registerDebug("conversation-memory.podcast");

// metadata for podcast messages

export class PodcastMessageMeta implements IKnowledgeSource {
    public listeners: string[] = [];

    constructor(public speaker?: string | undefined) {}

    getKnowledge() {
        if (this.speaker === undefined) {
            return {
                entities: [],
                actions: [],
                inverseActions: [],
                topics: [],
            };
        } else {
            const entities: kpLib.ConcreteEntity[] = [];
            entities.push({
                name: this.speaker,
                type: ["person"],
            } as kpLib.ConcreteEntity);
            const listenerEntities = this.listeners.map((listener) => {
                return {
                    name: listener,
                    type: ["person"],
                } as kpLib.ConcreteEntity;
            });
            entities.push(...listenerEntities);
            const actions: kpLib.Action[] = [];
            for (const listener of this.listeners) {
                actions.push({
                    verbs: ["say"],
                    verbTense: "past",
                    subjectEntityName: this.speaker,
                    objectEntityName: listener,
                } as kpLib.Action);
            }
            return {
                entities,
                actions,
                // TODO: Also create inverse actions
                inverseActions: [],
                topics: [],
            };
        }
    }
}

export class PodcastMessage implements IMessage {
    constructor(
        public textChunks: string[],
        public metadata: PodcastMessageMeta,
        public tags: string[] = [],
        public timestamp: string | undefined = undefined,
    ) {}

    public getKnowledge(): kpLib.KnowledgeResponse {
        return this.metadata.getKnowledge();
    }

    public addContent(content: string, chunkOrdinal = 0) {
        if (chunkOrdinal > this.textChunks.length) {
            this.textChunks.push(content);
        } else {
            this.textChunks[chunkOrdinal] += content;
        }
    }
}

export class Podcast implements IConversation<PodcastMessage> {
    public settings: ConversationSettings;
    public semanticRefIndex: ConversationIndex;
    public secondaryIndexes: PodcastSecondaryIndexes;
    public semanticRefs: SemanticRef[];

    private embeddingModel: TextEmbeddingModelWithCache | undefined;
    private embeddingSize: number | undefined;

    constructor(
        public nameTag: string = "",
        public messages: PodcastMessage[] = [],
        public tags: string[] = [],
        settings?: ConversationSettings,
    ) {
        this.semanticRefs = [];
        if (!settings) {
            settings = this.createSettings();
        }
        this.settings = settings;
        this.semanticRefIndex = new ConversationIndex();
        this.secondaryIndexes = new PodcastSecondaryIndexes(this.settings);
    }

    public getParticipants(): Set<string> {
        const participants = new Set<string>();
        for (const message of this.messages) {
            if (message.metadata.speaker) {
                participants.add(message.metadata.speaker);
            }
            for (const listener of message.metadata.listeners) {
                participants.add(listener);
            }
        }
        return participants;
    }

    public async buildIndex(
        eventHandler?: IndexingEventHandlers,
    ): Promise<IndexingResults> {
        this.beginIndexing();
        try {
            const result = await buildConversationIndex(
                this,
                this.settings,
                eventHandler,
            );
            // buildConversationIndex now automatically builds standard secondary indexes
            // Pass false to build podcast specific secondary indexes only
            await this.buildTransientSecondaryIndexes(false);
            await this.secondaryIndexes.threads.buildIndex();
            return result;
        } catch (ex) {
            debugLogger(`Podcast ${this.nameTag} buildIndex failed\n${ex}`);
            throw ex;
        } finally {
            this.endIndexing();
        }
    }

    public async buildSecondaryIndexes(
        eventHandler?: IndexingEventHandlers,
    ): Promise<SecondaryIndexingResults> {
        this.secondaryIndexes = new PodcastSecondaryIndexes(this.settings);
        const result = await buildSecondaryIndexes(
            this,
            this.settings,
            eventHandler,
        );
        await this.buildTransientSecondaryIndexes(false);
        await this.secondaryIndexes.threads.buildIndex();
        return result;
    }

    public async serialize(): Promise<PodcastData> {
        const data: PodcastData = {
            nameTag: this.nameTag,
            messages: this.messages,
            tags: this.tags,
            semanticRefs: this.semanticRefs,
            semanticIndexData: this.semanticRefIndex?.serialize(),
            relatedTermsIndexData:
                this.secondaryIndexes.termToRelatedTermsIndex.serialize(),
            threadData: this.secondaryIndexes.threads.serialize(),
            messageIndexData: this.secondaryIndexes.messageIndex?.serialize(),
        };
        return data;
    }

    public async deserialize(podcastData: PodcastData): Promise<void> {
        this.nameTag = podcastData.nameTag;
        const podcastMessages = podcastData.messages.map((m) => {
            const metadata = new PodcastMessageMeta(m.metadata.speaker);
            metadata.listeners = m.metadata.listeners;
            return new PodcastMessage(
                m.textChunks,
                metadata,
                m.tags,
                m.timestamp,
            );
        });
        this.messages = podcastMessages;
        this.semanticRefs = podcastData.semanticRefs;
        this.tags = podcastData.tags;
        if (podcastData.semanticIndexData) {
            this.semanticRefIndex = new ConversationIndex(
                podcastData.semanticIndexData,
            );
        }
        if (podcastData.relatedTermsIndexData) {
            this.secondaryIndexes.termToRelatedTermsIndex.deserialize(
                podcastData.relatedTermsIndexData,
            );
        }
        if (podcastData.threadData) {
            this.secondaryIndexes.threads = new ConversationThreads(
                this.settings.threadSettings,
            );
            this.secondaryIndexes.threads.deserialize(podcastData.threadData);
        }
        if (podcastData.messageIndexData) {
            this.secondaryIndexes.messageIndex = new MessageTextIndex(
                this.settings.messageTextIndexSettings,
            );
            this.secondaryIndexes.messageIndex.deserialize(
                podcastData.messageIndexData,
            );
        }
        await this.buildTransientSecondaryIndexes(true);
    }

    public async writeToFile(
        dirPath: string,
        baseFileName: string,
    ): Promise<void> {
        const data = await this.serialize();
        await writeConversationDataToFile(data, dirPath, baseFileName);
    }

    public static async readFromFile(
        dirPath: string,
        baseFileName: string,
    ): Promise<Podcast | undefined> {
        const podcast = new Podcast();
        const data = await readConversationDataFromFile(
            dirPath,
            baseFileName,
            podcast.settings.relatedTermIndexSettings.embeddingIndexSettings
                ?.embeddingSize,
        );
        if (data) {
            podcast.deserialize(data);
        }
        return podcast;
    }

    private async buildTransientSecondaryIndexes(all: boolean) {
        if (all) {
            // Build transient secondary indexes associated with the conversation
            // These are automatically build by calls to buildConversationIndex, but
            // may need to get rebuilt when we deserialize persisted conversations
            await buildTransientSecondaryIndexes(this, this.settings);
        }
        this.buildParticipantAliases();
    }

    private buildParticipantAliases(): void {
        const aliases = this.secondaryIndexes.termToRelatedTermsIndex.aliases;
        aliases.clear();
        const nameToAliasMap = this.collectParticipantAliases();
        for (const name of nameToAliasMap.keys()) {
            const relatedTerms: Term[] = nameToAliasMap
                .get(name)!
                .map((alias) => {
                    return { text: alias };
                });
            aliases.addRelatedTerm(name, relatedTerms);
        }
    }

    private collectParticipantAliases() {
        const aliases: collections.MultiMap<string, string> =
            new collections.MultiMap();
        for (const message of this.messages) {
            const metadata = message.metadata;
            collectName(metadata.speaker);
            for (const listener of metadata.listeners) {
                collectName(listener);
            }
        }

        function collectName(participantName: string | undefined) {
            if (participantName) {
                participantName = participantName.toLocaleLowerCase();
                const parsedName = kpLib.splitParticipantName(participantName);
                if (parsedName && parsedName.firstName && parsedName.lastName) {
                    // If participantName is a full name, then associate firstName with the full name
                    aliases.addUnique(parsedName.firstName, participantName);
                    aliases.addUnique(participantName, parsedName.firstName);
                }
            }
        }
        return aliases;
    }

    /**
     * Our index already has embeddings for every term in the podcast
     * Create a caching embedding model that can just leverage those embeddings
     * @returns embedding model, size of embedding
     */
    private createSettings() {
        const [model, size] = createEmbeddingModel(
            64,
            () => this.secondaryIndexes.termToRelatedTermsIndex.fuzzyIndex,
        );
        this.embeddingModel = model;
        this.embeddingSize = size;
        return createConversationSettings(
            this.embeddingModel,
            this.embeddingSize,
        );
    }

    private beginIndexing(): void {
        if (this.embeddingModel) {
            this.embeddingModel.cacheEnabled = false;
        }
    }
    private endIndexing(): void {
        if (this.embeddingModel) {
            this.embeddingModel.cacheEnabled = true;
        }
    }
}

export class PodcastSecondaryIndexes extends ConversationSecondaryIndexes {
    public threads: ConversationThreads;

    constructor(settings: ConversationSettings) {
        super(settings);
        this.threads = new ConversationThreads(settings.threadSettings);
    }
}

export interface PodcastData
    extends IConversationDataWithIndexes<PodcastMessage> {}
