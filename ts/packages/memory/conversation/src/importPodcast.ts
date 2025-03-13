// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IConversation,
    IMessage,
    SemanticRef,
    Term,
    ConversationIndex,
    IndexingResults,
    ConversationSettings,
    createConversationSettings,
    addMetadataToIndex,
    IKnowledgeSource,
    ConversationSecondaryIndexes,
    ConversationThreads,
    IndexingEventHandlers,
    buildConversationIndex,
    IConversationDataWithIndexes,
    writeConversationDataToFile,
    readConversationDataFromFile,
    MessageTextIndex,
    createTermEmbeddingCache,
    buildTransientSecondaryIndexes,
    buildSecondaryIndexes,
    SecondaryIndexingResults,
} from "knowpro";
import { conversation as kpLib, split } from "knowledge-processor";
import { collections, dateTime, getFileName, readAllText } from "typeagent";

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
                inverseActions: [],
                topics: [],
            };
        }
    }
}

function assignMessageListeners(
    msgs: PodcastMessage[],
    participants: Set<string>,
) {
    for (const msg of msgs) {
        if (msg.metadata.speaker) {
            let listeners: string[] = [];
            for (const p of participants) {
                if (p !== msg.metadata.speaker) {
                    listeners.push(p);
                }
            }
            msg.metadata.listeners = listeners;
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

    getKnowledge(): kpLib.KnowledgeResponse {
        return this.metadata.getKnowledge();
    }

    addTimestamp(timestamp: string) {
        this.timestamp = timestamp;
    }
    addContent(content: string) {
        this.textChunks[0] += content;
    }
}

export class Podcast implements IConversation<PodcastMessage> {
    public settings: ConversationSettings;
    public semanticRefIndex: ConversationIndex;
    public secondaryIndexes: PodcastSecondaryIndexes;

    constructor(
        public nameTag: string = "",
        public messages: PodcastMessage[] = [],
        public tags: string[] = [],
        public semanticRefs: SemanticRef[] = [],
    ) {
        this.settings = createConversationSettings();
        this.semanticRefIndex = new ConversationIndex();
        this.secondaryIndexes = new PodcastSecondaryIndexes(this.settings);
    }

    public addMetadataToIndex() {
        if (this.semanticRefIndex) {
            addMetadataToIndex(
                this.messages,
                this.semanticRefs,
                this.semanticRefIndex,
            );
        }
    }

    public generateTimestamps(startDate: Date, lengthMinutes: number = 60) {
        timestampMessages(
            this.messages,
            startDate,
            dateTime.addMinutesToDate(startDate, lengthMinutes),
        );
    }

    public async buildIndex(
        eventHandler?: IndexingEventHandlers,
    ): Promise<IndexingResults> {
        this.addMetadataToIndex();
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
            messageIndexData: this.secondaryIndexes.messageIndex.serialize(),
        };
        return data;
    }

    public async deserialize(podcastData: PodcastData): Promise<void> {
        this.nameTag = podcastData.nameTag;
        this.messages = podcastData.messages.map((m) => {
            const metadata = new PodcastMessageMeta(m.metadata.speaker);
            metadata.listeners = m.metadata.listeners;
            return new PodcastMessage(
                m.textChunks,
                metadata,
                m.tags,
                m.timestamp,
            );
        });
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
        this.buildCaches();
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

    private buildCaches(): void {
        createTermEmbeddingCache(
            this.settings.relatedTermIndexSettings.embeddingIndexSettings!,
            this.secondaryIndexes.termToRelatedTermsIndex.fuzzyIndex!,
            64,
        );
    }
}

export class PodcastSecondaryIndexes extends ConversationSecondaryIndexes {
    public threads: ConversationThreads;
    public messageIndex: MessageTextIndex;

    constructor(settings: ConversationSettings) {
        super(settings.relatedTermIndexSettings);
        this.threads = new ConversationThreads(settings.threadSettings);
        this.messageIndex = new MessageTextIndex(
            settings.messageTextIndexSettings,
        );
    }
}

//const DataFileSuffix = "_data.json";
//const EmbeddingFileSuffix = "_embeddings.bin";

export interface PodcastData
    extends IConversationDataWithIndexes<PodcastMessage> {}

export async function importPodcast(
    transcriptFilePath: string,
    podcastName?: string,
    startDate?: Date,
    lengthMinutes: number = 60,
): Promise<Podcast> {
    const transcriptText = await readAllText(transcriptFilePath);
    podcastName ??= getFileName(transcriptFilePath);
    const transcriptLines = split(transcriptText, /\r?\n/, {
        removeEmpty: true,
        trim: true,
    });
    const turnParseRegex = /^(?<speaker>[A-Z0-9 ]+:)?(?<speech>.*)$/;
    const participants = new Set<string>();
    const msgs: PodcastMessage[] = [];
    let curMsg: PodcastMessage | undefined = undefined;
    for (const line of transcriptLines) {
        const match = turnParseRegex.exec(line);
        if (match && match.groups) {
            let speaker = match.groups["speaker"];
            let speech = match.groups["speech"];
            if (curMsg) {
                if (speaker) {
                    msgs.push(curMsg);
                    curMsg = undefined;
                } else {
                    curMsg.addContent("\n" + speech);
                }
            }
            if (!curMsg) {
                if (speaker) {
                    speaker = speaker.trim();
                    if (speaker.endsWith(":")) {
                        speaker = speaker.slice(0, speaker.length - 1);
                    }
                    speaker = speaker.toLocaleLowerCase();
                    participants.add(speaker);
                }
                curMsg = new PodcastMessage(
                    [speech],
                    new PodcastMessageMeta(speaker),
                );
            }
        }
    }
    if (curMsg) {
        msgs.push(curMsg);
    }
    assignMessageListeners(msgs, participants);
    const pod = new Podcast(podcastName, msgs, [podcastName]);
    if (startDate) {
        pod.generateTimestamps(startDate, lengthMinutes);
    }
    // TODO: add more tags
    return pod;
}

/**
 * Text (such as a transcript) can be collected over a time range.
 * This text can be partitioned into blocks. However, timestamps for individual blocks are not available.
 * Assigns individual timestamps to blocks proportional to their lengths.
 * @param turns Transcript turns to assign timestamps to
 * @param startDate starting
 * @param endDate
 */
export function timestampMessages(
    messages: IMessage[],
    startDate: Date,
    endDate: Date,
): void {
    let startTicks = startDate.getTime();
    const ticksLength = endDate.getTime() - startTicks;
    if (ticksLength <= 0) {
        throw new Error(`${startDate} is not < ${endDate}`);
    }
    let messageLengths = messages.map((m) => messageLength(m));
    const textLength: number = messageLengths.reduce(
        (total: number, l) => total + l,
        0,
    );
    const ticksPerChar = ticksLength / textLength;
    for (let i = 0; i < messages.length; ++i) {
        messages[i].timestamp = new Date(startTicks).toISOString();
        // Now, we will 'elapse' time .. proportional to length of the text
        // This assumes that each speaker speaks equally fast...
        startTicks += ticksPerChar * messageLengths[i];
    }

    function messageLength(message: IMessage): number {
        return message.textChunks.reduce(
            (total: number, chunk) => total + chunk.length,
            0,
        );
    }
}
