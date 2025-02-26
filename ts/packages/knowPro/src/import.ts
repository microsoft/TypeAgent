// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IConversation,
    IMessage,
    IKnowledgeSource,
    SemanticRef,
    IConversationData,
    Term,
} from "./dataFormat.js";
import { conversation as kpLib, split } from "knowledge-processor";
import {
    collections,
    dateTime,
    getFileName,
    readAllText,
    readFile,
    readJsonFile,
    writeFile,
    writeJsonFile,
} from "typeagent";
import {
    ConversationIndex,
    addActionToIndex,
    addEntityToIndex,
    buildConversationIndex,
    addTopicToIndex,
    ConversationIndexingResult,
} from "./conversationIndex.js";
import { Result } from "typechat";
import {
    TermToRelatedTermsIndex,
    TermsToRelatedTermIndexSettings,
} from "./relatedTermsIndex.js";
import {
    createTextEmbeddingIndexSettings,
    deserializeEmbeddings,
    serializeEmbeddings,
    TextEmbeddingIndexSettings,
} from "./fuzzyIndex.js";
import { TimestampToTextRangeIndex } from "./timestampIndex.js";
import {
    IPropertyToSemanticRefIndex,
    ITermsToRelatedTermsIndexData,
    ITimestampToTextRangeIndex,
} from "./secondaryIndexes.js";
import { addPropertiesToIndex, PropertyIndex } from "./propertyIndex.js";
import { IConversationSecondaryIndexes } from "./secondaryIndexes.js";
import {
    IConversationThreadData,
    ConversationThreads,
} from "./conversationThread.js";
import path from "path";

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

export type PodcastSettings = {
    relatedTermIndexSettings: TermsToRelatedTermIndexSettings;
    threadSettings: TextEmbeddingIndexSettings;
};

export function createPodcastSettings(): PodcastSettings {
    const embeddingIndexSettings = createTextEmbeddingIndexSettings();
    return {
        relatedTermIndexSettings: {
            embeddingIndexSettings,
        },
        threadSettings: embeddingIndexSettings,
    };
}

export class Podcast
    implements IConversation<PodcastMessageMeta>, IConversationSecondaryIndexes
{
    public settings: PodcastSettings;
    public semanticRefIndex: ConversationIndex | undefined;
    public termToRelatedTermsIndex: TermToRelatedTermsIndex | undefined;
    public timestampIndex: ITimestampToTextRangeIndex | undefined;
    public propertyToSemanticRefIndex: IPropertyToSemanticRefIndex | undefined;
    public threads: ConversationThreads;

    constructor(
        public nameTag: string = "",
        public messages: PodcastMessage[] = [],
        public tags: string[] = [],
        public semanticRefs: SemanticRef[] = [],
    ) {
        this.settings = createPodcastSettings();
        this.threads = new ConversationThreads(this.settings.threadSettings);
    }

    public addMetadataToIndex() {
        for (let i = 0; i < this.messages.length; i++) {
            const msg = this.messages[i];
            const knowledgeResponse = msg.metadata.getKnowledge();
            if (this.semanticRefIndex !== undefined) {
                for (const entity of knowledgeResponse.entities) {
                    addEntityToIndex(
                        entity,
                        this.semanticRefs,
                        this.semanticRefIndex,
                        i,
                    );
                }
                for (const action of knowledgeResponse.actions) {
                    addActionToIndex(
                        action,
                        this.semanticRefs,
                        this.semanticRefIndex,
                        i,
                    );
                }
                for (const topic of knowledgeResponse.topics) {
                    addTopicToIndex(
                        topic,
                        this.semanticRefs,
                        this.semanticRefIndex,
                        i,
                    );
                }
            }
        }
    }

    public generateTimestamps(startDate?: Date, lengthMinutes: number = 60) {
        // generate a random date within the last 10 years
        startDate ??= randomDate();
        timestampMessages(
            this.messages,
            startDate,
            dateTime.addMinutesToDate(startDate, lengthMinutes),
        );
    }

    public async buildIndex(
        progressCallback?: (
            text: string,
            knowledgeResult: Result<kpLib.KnowledgeResponse>,
        ) => boolean,
    ): Promise<ConversationIndexingResult> {
        const result = await buildConversationIndex(this, progressCallback);
        this.addMetadataToIndex();
        this.buildSecondaryIndexes();
        await this.threads.buildIndex();
        return result;
    }

    public async buildRelatedTermsIndex(
        batchSize: number = 8,
        progressCallback?: (batch: string[], batchStartAt: number) => boolean,
    ): Promise<void> {
        if (this.semanticRefIndex) {
            this.termToRelatedTermsIndex = new TermToRelatedTermsIndex(
                this.settings.relatedTermIndexSettings,
            );
            const allTerms = this.semanticRefIndex?.getTerms();
            await this.termToRelatedTermsIndex.buildEmbeddingsIndex(
                allTerms,
                batchSize,
                progressCallback,
            );
        }
    }

    public serialize(): PodcastData {
        return {
            nameTag: this.nameTag,
            messages: this.messages,
            tags: this.tags,
            semanticRefs: this.semanticRefs,
            semanticIndexData: this.semanticRefIndex?.serialize(),
            relatedTermsIndexData: this.termToRelatedTermsIndex?.serialize(),
            threadData: this.threads.serialize(),
        };
    }

    public deserialize(data: PodcastData): void {
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
            this.termToRelatedTermsIndex = new TermToRelatedTermsIndex(
                this.settings.relatedTermIndexSettings,
            );
            this.termToRelatedTermsIndex.deserialize(
                data.relatedTermsIndexData,
            );
        }
        if (data.threadData) {
            this.threads = new ConversationThreads(
                this.settings.threadSettings,
            );
            this.threads.deserialize(data.threadData);
        }
        this.buildSecondaryIndexes();
    }

    public async writeToFile(
        dirPath: string,
        baseFileName: string,
    ): Promise<void> {
        const podcastData = this.serialize();
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
            if (embeddings) {
                embeddingData.embeddings = deserializeEmbeddings(
                    embeddings,
                    podcast.settings.relatedTermIndexSettings
                        .embeddingIndexSettings.embeddingSize,
                );
            }
        }
        podcast.deserialize(data);
        return podcast;
    }

    private buildSecondaryIndexes() {
        this.buildParticipantAliases();
        this.buildPropertyIndex();
        this.buildTimestampIndex();
    }

    private buildPropertyIndex() {
        if (this.semanticRefs && this.semanticRefs.length > 0) {
            this.propertyToSemanticRefIndex = new PropertyIndex();
            addPropertiesToIndex(
                this.semanticRefs,
                this.propertyToSemanticRefIndex,
            );
        }
    }

    private buildTimestampIndex(): void {
        this.timestampIndex = new TimestampToTextRangeIndex(this.messages);
    }

    private buildParticipantAliases(): void {
        if (this.termToRelatedTermsIndex) {
            const nameToAliasMap = this.collectParticipantAliases();
            for (const name of nameToAliasMap.keys()) {
                const relatedTerms: Term[] = nameToAliasMap
                    .get(name)!
                    .map((alias) => {
                        return { text: alias };
                    });
                this.termToRelatedTermsIndex.aliases.addRelatedTerm(
                    name,
                    relatedTerms,
                );
            }
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
                participantName = participantName.toLowerCase();
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

const DataFileSuffix = "_data.json";
const EmbeddingFileSuffix = "_embeddings.bin";

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
    pod.generateTimestamps(startDate, lengthMinutes);
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

function randomDate(startHour = 14) {
    const date = new Date();
    date.setFullYear(date.getFullYear() - Math.floor(Math.random() * 10));
    date.setMonth(Math.floor(Math.random() * 12));
    date.setDate(Math.floor(Math.random() * 28));
    return date;
}
