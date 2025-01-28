// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IConversation,
    IMessage,
    IKnowledgeSource,
    SemanticRef,
    IConversationData,
    ITextEmbeddingData,
} from "./dataFormat.js";
import { conversation, split } from "knowledge-processor";
import { collections, getFileName, readAllText } from "typeagent";
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
    buildTermSemanticIndex,
    createSemanticIndexSettings,
    SemanticIndexSettings,
    TermSemanticIndex,
} from "./termIndex.js";

// metadata for podcast messages
export class PodcastMessageMeta implements IKnowledgeSource {
    constructor(public speaker: string | undefined) {}
    listeners: string[] = [];
    getKnowledge() {
        if (this.speaker === undefined) {
            return {
                entities: [],
                actions: [],
                inverseActions: [],
                topics: [],
            };
        } else {
            const entities: conversation.ConcreteEntity[] = [];
            entities.push({
                name: this.speaker,
                type: ["person"],
            } as conversation.ConcreteEntity);
            const listenerEntities = this.listeners.map((listener) => {
                return {
                    name: listener,
                    type: ["person"],
                } as conversation.ConcreteEntity;
            });
            entities.push(...listenerEntities);
            const actions: conversation.Action[] = [];
            for (const listener of this.listeners) {
                actions.push({
                    verbs: ["say"],
                    verbTense: "past",
                    subjectEntityName: this.speaker,
                    objectEntityName: listener,
                } as conversation.Action);
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
    timestamp: string | undefined;
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
    relatedTermIndexSettings: SemanticIndexSettings;
};

export function createPodcastSettings(): PodcastSettings {
    return {
        relatedTermIndexSettings: createSemanticIndexSettings(),
    };
}

export class Podcast implements IConversation<PodcastMessageMeta> {
    public settings: PodcastSettings;
    constructor(
        public nameTag: string,
        public messages: PodcastMessage[],
        public tags: string[] = [],
        public semanticRefs: SemanticRef[] = [],
        public semanticRefIndex: ConversationIndex | undefined = undefined,
        public relatedTermsIndex: TermSemanticIndex | undefined = undefined,
    ) {
        this.settings = createPodcastSettings();
    }

    addMetadataToIndex() {
        for (let i = 0; i < this.messages.length; i++) {
            const msg = this.messages[i];
            const knowlegeResponse = msg.metadata.getKnowledge();
            if (this.semanticRefIndex !== undefined) {
                for (const entity of knowlegeResponse.entities) {
                    addEntityToIndex(
                        entity,
                        this.semanticRefs,
                        this.semanticRefIndex,
                        i,
                    );
                }
                for (const action of knowlegeResponse.actions) {
                    addActionToIndex(
                        action,
                        this.semanticRefs,
                        this.semanticRefIndex,
                        i,
                    );
                }
                for (const topic of knowlegeResponse.topics) {
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

    generateTimestamps() {
        // generate a random date within the last 10 years
        const date = new Date();
        const startHour = 14;
        date.setFullYear(date.getFullYear() - Math.floor(Math.random() * 10));
        date.setMonth(Math.floor(Math.random() * 12));
        date.setDate(Math.floor(Math.random() * 28));
        const seconds = 3600;
        let cumulativeLength = 0;
        const cumulativeLengths = this.messages.map((msg) => {
            const msgCum = cumulativeLength;
            cumulativeLength += msg.textChunks[0].length;
            return msgCum;
        });
        for (let i = 0; i < this.messages.length; i++) {
            const lengthPct = cumulativeLengths[i] / cumulativeLength;
            const msgSeconds = lengthPct * seconds;
            const minutes = Math.floor((msgSeconds % 3600) / 60);
            const secs = Math.floor(msgSeconds % 60);
            const timestamp = `${date.toISOString()}T${startHour}:${minutes}:${secs}`;
            this.messages[i].timestamp = timestamp;
        }
    }

    public async buildIndex(
        progressCallback?: (
            text: string,
            knowledgeResult: Result<conversation.KnowledgeResponse>,
        ) => boolean,
    ): Promise<ConversationIndexingResult> {
        const result = await buildConversationIndex(this, progressCallback);
        this.addMetadataToIndex();
        return result;
    }

    public async buildRelatedTermsIndex(
        batchSize: number = 8,
        progressCallback?: (
            terms: string[],
            batch: collections.Slice<string>,
        ) => boolean,
    ): Promise<void> {
        if (this.settings.relatedTermIndexSettings && this.semanticRefIndex) {
            const allTerms = this.semanticRefIndex?.getTerms();
            this.relatedTermsIndex = await buildTermSemanticIndex(
                this.settings.relatedTermIndexSettings,
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
            relatedTermIndexData: this.relatedTermsIndex?.serialize(),
        };
    }

    public deserialize(data: PodcastData): void {
        if (data.semanticIndexData) {
            this.semanticRefIndex = new ConversationIndex(
                data.semanticIndexData,
            );
        }
        if (data.relatedTermIndexData) {
            this.relatedTermsIndex = new TermSemanticIndex(
                this.settings.relatedTermIndexSettings,
                data.relatedTermIndexData,
            );
        }
    }
}

export interface PodcastData extends IConversationData<PodcastMessage> {
    relatedTermIndexData?: ITextEmbeddingData | undefined;
}

export async function importPodcast(
    transcriptFilePath: string,
    podcastName?: string,
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
    // TODO: add timestamps and more tags
    // list all the books
    // what did K say about Children of Time?
    return pod;
}
