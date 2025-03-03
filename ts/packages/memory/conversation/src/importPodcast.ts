// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IConversation,
    IMessage,
    SemanticRef,
    IConversationData,
    Term,
    ConversationIndex,
    IndexingResults,
    ITermsToRelatedTermsIndexData,
    IConversationThreadData,
    //deserializeEmbeddings,
    //serializeEmbeddings,
    ConversationSettings,
    createConversationSettings,
    addMetadataToIndex,
    buildSecondaryIndexes,
    IKnowledgeSource,
    ConversationSecondaryIndexes,
    ConversationThreads,
    IndexingEventHandlers,
    buildConversationIndex,
    writeConversationToFile,
    IPersistedConversationData,
    readConversationFromFile,
} from "knowpro";
import { conversation as kpLib, split } from "knowledge-processor";
import {
    collections,
    dateTime,
    getFileName,
    readAllText,
    //readFile,
    //readJsonFile,
    //writeFile,
    //writeJsonFile,
} from "typeagent";
//import path from "path";

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
    msgs: IMessage<PodcastMessageMeta>[],
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

export class PodcastMessage implements IMessage<PodcastMessageMeta> {
    public timestamp: string | undefined;
    constructor(
        public textChunks: string[],
        public metadata: PodcastMessageMeta,
        public tags: string[] = [],
    ) {}
    addTimestamp(timestamp: string) {
        this.timestamp = timestamp;
    }
    addContent(content: string) {
        this.textChunks[0] += content;
    }
}

export class Podcast implements IConversation<PodcastMessageMeta> {
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
        const result = await buildConversationIndex(this, eventHandler);
        if (!result.error) {
            // buildConversationIndex already built all aliases
            await this.buildSecondaryIndexes(false);
            await this.secondaryIndexes.threads.buildIndex();
        }
        return result;
    }

    public async serialize(): Promise<PodcastData> {
        return {
            nameTag: this.nameTag,
            messages: this.messages,
            tags: this.tags,
            semanticRefs: this.semanticRefs,
            semanticIndexData: this.semanticRefIndex?.serialize(),
            relatedTermsIndexData:
                this.secondaryIndexes.termToRelatedTermsIndex.serialize(),
            threadData: this.secondaryIndexes.threads.serialize(),
        };
    }

    public async deserialize(data: PodcastData): Promise<void> {
        this.nameTag = data.nameTag;
        this.messages = data.messages;
        this.semanticRefs = data.semanticRefs;
        this.tags = data.tags;
        if (data.semanticIndexData) {
            this.semanticRefIndex = new ConversationIndex(
                data.semanticIndexData,
            );
        }
        if (data.relatedTermsIndexData) {
            this.secondaryIndexes.termToRelatedTermsIndex.deserialize(
                data.relatedTermsIndexData,
            );
        }
        if (data.threadData) {
            this.secondaryIndexes.threads = new ConversationThreads(
                this.settings.threadSettings,
            );
            this.secondaryIndexes.threads.deserialize(data.threadData);
        }
        await this.buildSecondaryIndexes(true);
    }
    /*
    public async writeToFile(
        dirPath: string,
        baseFileName: string,
    ): Promise<void> {
        const podcastData = await this.serialize();
        const embeddingData =
            podcastData.relatedTermsIndexData?.textEmbeddingData;
        if (embeddingData?.embeddings) {
            await writeFile(
                path.join(dirPath, baseFileName + EmbeddingFileSuffix),
                serializeEmbeddings(embeddingData.embeddings),
            );
            embeddingData.embeddings = [];
        }
        await writeJsonFile(
            path.join(dirPath, baseFileName + DataFileSuffix),
            podcastData,
        );
    }

    public static async readFromFile(
        dirPath: string,
        baseFileName: string,
    ): Promise<Podcast | undefined> {
        const data = await readJsonFile<PodcastData>(
            path.join(dirPath, baseFileName + DataFileSuffix),
        );
        if (!data) {
            return undefined;
        }
        const podcast = new Podcast();
        const embeddingData = data.relatedTermsIndexData?.textEmbeddingData;
        if (embeddingData) {
            const embeddings = await readFile(
                path.join(dirPath, baseFileName + EmbeddingFileSuffix),
            );
            const embeddingSettings =
                podcast.settings.relatedTermIndexSettings
                    .embeddingIndexSettings;
            if (embeddings && embeddingSettings) {
                embeddingData.embeddings = deserializeEmbeddings(
                    embeddings,
                    embeddingSettings.embeddingSize,
                );
            }
        }
        await podcast.deserialize(data);
        return podcast;
    }
    */

    public async writeToFile(
        dirPath: string,
        baseFileName: string,
    ): Promise<void> {
        await writeConversationToFile(
            this,
            dirPath,
            baseFileName,
            async (conversation) => {
                const conversationData = await this.serialize();
                let serializationData: IPersistedConversationData<PodcastData> =
                    {
                        conversationData,
                    };
                const embeddingData =
                    conversationData.relatedTermsIndexData?.textEmbeddingData;
                if (embeddingData) {
                    serializationData.embeddings = embeddingData.embeddings;
                    embeddingData.embeddings = [];
                }
                return serializationData;
            },
        );
    }

    public static async readFromFile(
        dirPath: string,
        baseFileName: string,
    ): Promise<Podcast | undefined> {
        const podcast = new Podcast();
        await readConversationFromFile<PodcastData>(
            dirPath,
            baseFileName,
            podcast.settings.relatedTermIndexSettings.embeddingIndexSettings
                ?.embeddingSize,
            async (persistentData) => {
                const embeddingData =
                    persistentData.conversationData.relatedTermsIndexData
                        ?.textEmbeddingData;
                if (persistentData.embeddings && embeddingData) {
                    embeddingData.embeddings = persistentData.embeddings;
                }
                podcast.deserialize(persistentData.conversationData);
                return podcast;
            },
        );
        return podcast;
    }

    private async buildSecondaryIndexes(all: boolean) {
        if (all) {
            await buildSecondaryIndexes(this, false);
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
}

export class PodcastSecondaryIndexes extends ConversationSecondaryIndexes {
    public threads: ConversationThreads;

    constructor(settings: ConversationSettings) {
        super(settings.relatedTermIndexSettings);
        this.threads = new ConversationThreads(settings.threadSettings);
    }
}

//const DataFileSuffix = "_data.json";
//const EmbeddingFileSuffix = "_embeddings.bin";

export interface PodcastData extends IConversationData<PodcastMessage> {
    relatedTermsIndexData?: ITermsToRelatedTermsIndexData | undefined;
    threadData?: IConversationThreadData;
}

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
