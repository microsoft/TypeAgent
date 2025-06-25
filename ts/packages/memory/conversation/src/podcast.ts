// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import {
    conversation as kpLib,
    TextEmbeddingModelWithCache,
} from "knowledge-processor";
import { collections } from "typeagent";
import { createEmbeddingModelWithCache } from "./common.js";

import registerDebug from "debug";
import { PodcastMessage, PodcastMessageMeta } from "./podcastMessage.js";
import { addSynonymsFileAsAliases } from "./memory.js";
import { getAbsolutePathFromUrl } from "memory-storage";
const debugLogger = registerDebug("conversation-memory.podcast");

export class Podcast implements kp.IConversation<PodcastMessage> {
    public settings: kp.ConversationSettings;
    public messages: kp.MessageCollection<PodcastMessage>;
    public semanticRefIndex: kp.ConversationIndex;
    public secondaryIndexes: PodcastSecondaryIndexes;
    public semanticRefs: kp.SemanticRefCollection;

    private embeddingModel: TextEmbeddingModelWithCache | undefined;
    private embeddingSize: number | undefined;

    constructor(
        public nameTag: string = "",
        messages: PodcastMessage[] = [],
        public tags: string[] = [],
        settings?: kp.ConversationSettings,
    ) {
        this.messages = new kp.MessageCollection<PodcastMessage>(messages);
        this.semanticRefs = new kp.SemanticRefCollection();
        if (!settings) {
            settings = this.createSettings();
        }
        this.settings = settings;
        this.semanticRefIndex = new kp.ConversationIndex();
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
        eventHandler?: kp.IndexingEventHandlers,
    ): Promise<kp.IndexingResults> {
        this.beginIndexing();
        try {
            const result = await kp.buildConversationIndex(
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
        eventHandler?: kp.IndexingEventHandlers,
    ): Promise<kp.SecondaryIndexingResults> {
        this.secondaryIndexes = new PodcastSecondaryIndexes(this.settings);
        const result = await kp.buildSecondaryIndexes(
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
            messages: this.messages.getAll(),
            tags: this.tags,
            semanticRefs: this.semanticRefs.getAll(),
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
        this.messages = new kp.MessageCollection<PodcastMessage>(
            podcastMessages,
        );
        this.semanticRefs = new kp.SemanticRefCollection(
            podcastData.semanticRefs,
        );
        this.tags = podcastData.tags;
        if (podcastData.semanticIndexData) {
            this.semanticRefIndex = new kp.ConversationIndex(
                podcastData.semanticIndexData,
            );
        }
        if (podcastData.relatedTermsIndexData) {
            this.secondaryIndexes.termToRelatedTermsIndex.deserialize(
                podcastData.relatedTermsIndexData,
            );
        }
        if (podcastData.threadData) {
            this.secondaryIndexes.threads = new kp.ConversationThreads(
                this.settings.threadSettings,
            );
            this.secondaryIndexes.threads.deserialize(podcastData.threadData);
        }
        if (podcastData.messageIndexData) {
            this.secondaryIndexes.messageIndex = new kp.MessageTextIndex(
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
        await kp.writeConversationDataToFile(data, dirPath, baseFileName);
    }

    public static async readFromFile(
        dirPath: string,
        baseFileName: string,
        settings?: kp.ConversationSettings,
    ): Promise<Podcast | undefined> {
        const podcast = new Podcast(undefined, undefined, undefined, settings);
        const data = await kp.readConversationDataFromFile(
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
            await kp.buildTransientSecondaryIndexes(this, this.settings);
        }
        this.buildParticipantAliases();
        this.addSynonyms();
    }

    private buildParticipantAliases(): void {
        const aliases = this.secondaryIndexes.termToRelatedTermsIndex.aliases;
        aliases.clear();
        const nameToAliasMap = this.collectParticipantAliases();
        for (const name of nameToAliasMap.keys()) {
            const relatedTerms: kp.Term[] = nameToAliasMap
                .get(name)!
                .map((alias) => {
                    return { text: alias };
                });
            aliases.addRelatedTerm(name, relatedTerms);
        }
    }

    private addSynonyms() {
        const aliases = this.secondaryIndexes.termToRelatedTermsIndex.aliases;
        addSynonymsFileAsAliases(
            aliases,
            getAbsolutePathFromUrl(import.meta.url, "podcastVerbs.json"),
        );
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
        const [model, size] = createEmbeddingModelWithCache(
            64,
            () => this.secondaryIndexes.termToRelatedTermsIndex.fuzzyIndex,
        );
        this.embeddingModel = model;
        this.embeddingSize = size;
        return kp.createConversationSettings(
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

export class PodcastSecondaryIndexes extends kp.ConversationSecondaryIndexes {
    public threads: kp.ConversationThreads;

    constructor(settings: kp.ConversationSettings) {
        super(settings);
        this.threads = new kp.ConversationThreads(settings.threadSettings);
    }
}

export interface PodcastData
    extends kp.IConversationDataWithIndexes<PodcastMessage> {}
