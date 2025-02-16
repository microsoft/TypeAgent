// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IConversation,
    IMessage,
    IKnowledgeSource,
    SemanticRef,
    IConversationData,
    ITimestampToTextRangeIndex,
    IPropertyToSemanticRefIndex,
} from "./dataFormat.js";
import { conversation, split, image } from "knowledge-processor";
import { collections, dateTime, getFileName, isDirectoryPath, readAllText } from "typeagent";
import {
    ConversationIndex,
    addActionToIndex,
    addEntityToIndex,
    buildConversationIndex,
    addTopicToIndex,
    ConversationIndexingResult,
    createKnowledgeModel,
} from "./conversationIndex.js";
import { Result } from "typechat";
import {
    createTextEmbeddingIndexSettings,
    TermToRelatedTermsIndex,
    TermsToRelatedTermIndexSettings,
} from "./relatedTermsIndex.js";
import { TimestampToTextRangeIndex } from "./timestampIndex.js";
import { addPropertiesToIndex, PropertyIndex } from "./propertyIndex.js";
import fs from "node:fs";
import path from "node:path";
import { isImageFileType } from "common-utils";
import { ChatModel } from "aiclient";

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
    relatedTermIndexSettings: TermsToRelatedTermIndexSettings;
};

export function createPodcastSettings(): PodcastSettings {
    return {
        relatedTermIndexSettings: {
            embeddingIndexSettings: createTextEmbeddingIndexSettings(),
        },
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
        public termToRelatedTermsIndex:
            | TermToRelatedTermsIndex
            | undefined = undefined,
        public timestampIndex:
            | ITimestampToTextRangeIndex
            | undefined = undefined,
        public propertyToSemanticRefIndex:
            | IPropertyToSemanticRefIndex
            | undefined = undefined,
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
            knowledgeResult: Result<conversation.KnowledgeResponse>,
        ) => boolean,
    ): Promise<ConversationIndexingResult> {
        const result = await buildConversationIndex(this, progressCallback);
        this.addMetadataToIndex();
        this.buildPropertyIndex();
        this.buildTimestampIndex();
        return result;
    }

    public buildPropertyIndex() {
        if (this.semanticRefs && this.semanticRefs.length > 0) {
            this.propertyToSemanticRefIndex = new PropertyIndex();
            addPropertiesToIndex(
                this.semanticRefs,
                this.propertyToSemanticRefIndex,
            );
        }
    }

    public async buildRelatedTermsIndex(
        batchSize: number = 8,
        progressCallback?: (
            terms: string[],
            batch: collections.Slice<string>,
        ) => boolean,
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

    public buildTimestampIndex(): void {
        this.timestampIndex = new TimestampToTextRangeIndex(this.messages);
    }

    public serialize(): PodcastData {
        return {
            nameTag: this.nameTag,
            messages: this.messages,
            tags: this.tags,
            semanticRefs: this.semanticRefs,
            semanticIndexData: this.semanticRefIndex?.serialize(),
            relatedTermsIndexData: this.termToRelatedTermsIndex?.serialize(),
        };
    }

    public deserialize(data: PodcastData): void {
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
        this.buildPropertyIndex();
        this.buildTimestampIndex();
    }
}

export interface PodcastData extends IConversationData<PodcastMessage> {}

export interface ImageCollectionData extends IConversationData<Image> {}

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
    // list all the books
    // what did K say about Children of Time?
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

export class Image implements IMessage<ImageMeta> {
    public timestamp: string | undefined;
    constructor(
        public textChunks: string[],
        public metadata: ImageMeta,
        public tags: string[] = [],
    ) {}
}

// metadata for images
export class ImageMeta implements IKnowledgeSource {
    constructor(public fileName: string, public image: image.Image) {}

    getKnowledge() {
        throw new Error("Not implemented!");

        return {
            entities: [],
            actions: [],
            inverseActions: [],
            topics: []
        }
    }
}

export class ImageCollection implements IConversation<ImageMeta> {
    public settings: PodcastSettings;
    constructor(
        public nameTag: string,
        public messages: Image[],
        public tags: string[] = [],
        public semanticRefs: SemanticRef[] = [],
        public semanticRefIndex: ConversationIndex | undefined = undefined,
        public termToRelatedTermsIndex:
            | TermToRelatedTermsIndex
            | undefined = undefined,
        public timestampIndex:
            | ITimestampToTextRangeIndex
            | undefined = undefined,
        public propertyToSemanticRefIndex:
            | IPropertyToSemanticRefIndex
            | undefined = undefined,
    ) { 
        this.settings = createPodcastSettings();
    }

    public buildTimestampIndex(): void {
        this.timestampIndex = new TimestampToTextRangeIndex(this.messages);
    }

    public buildPropertyIndex() {
        if (this.semanticRefs && this.semanticRefs.length > 0) {
            this.propertyToSemanticRefIndex = new PropertyIndex();
            addPropertiesToIndex(
                this.semanticRefs,
                this.propertyToSemanticRefIndex,
            );
        }
    }    
       
    public serialize(): ImageCollectionData {
        return {
            nameTag: this.nameTag,
            messages: this.messages,
            tags: this.tags,
            semanticRefs: this.semanticRefs,
            semanticIndexData: this.semanticRefIndex?.serialize(),
            relatedTermsIndexData: this.termToRelatedTermsIndex?.serialize(),
        };
    }

    public deserialize(data: ImageCollectionData): void {
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
        this.buildPropertyIndex();
        this.buildTimestampIndex();
    }    
}

/**
 * Indexes the supplied image or images in the supplied folder.
 *
 * @param imagePath - The path to the image file or a folder containing images
 * @param recursive - A flag indicating if the search should include subfolders
 * @returns - The imported images as an image collection.
 */
export async function importImageCollection(
    imagePath: string,
    recursive: boolean = true
): Promise<ImageCollection> {

    let isDir = isDirectoryPath(imagePath);

    if (!fs.existsSync(imagePath)) {
        throw Error(`The supplied file or folder '${imagePath}' does not exist.`);
    }

    // const clock: StopWatch = new StopWatch();
    // const tokenCountStart: CompletionUsageStats =
    //     TokenCounter.getInstance().total;
    
    // create a model used to extract data from the images
    const chatModel = createKnowledgeModel();

    let images: Image[] = [];
    if (isDir) {
        images = await indexImages(imagePath, recursive, chatModel);
    } else {
        const img = await indexImage(imagePath, chatModel);
        if (img !== undefined) {
            images.push(img);
        }
    }

    return new ImageCollection(
        path.dirname(imagePath),
        images
    );
}

/**
 * Imports images from the supplied folder.
 * 
 * @param sourcePath - The folder to import.
 * @param recursive - A flag indicating whether or not subfolders are imported.
 * @param chatModel - The model used to extract data from the image.
 * @returns - The imported images from the supplied folder.
 */
async function indexImages(
    sourcePath: string,
    recursive: boolean,
    chatModel: ChatModel
): Promise<Image[]> {
    // load files from the supplied directory
    const fileNames = await fs.promises.readdir(sourcePath, {
        recursive: true,
    });

    // index each image
    const retVal: Image[] = []    
    for (let i = 0; i < fileNames.length; i++) {
        const fullFilePath: string = path.join(sourcePath, fileNames[i]);
        //console.log(`${fullFilePath} [${i+1} of ${fileNames.length}] (estimated time remaining: ${clock.elapsedSeconds / (i + 1) * (fileNames.length - i)})`);
        const img = await indexImage(fullFilePath, chatModel);

        if (img !== undefined) {
            retVal.push(img);
        }
    }

    return retVal;
}

/**
 * Imports the supplied image file (if it's an image)
 * 
 * @param fileName - The file to import
 * @param chatModel - The model used to extract data from the image.
 * @returns - The imported image.
 */
async function indexImage(fileName: string, chatModel: ChatModel): Promise<Image | undefined> {
    if (!fs.existsSync(fileName)) {
        console.log(`Could not find part of the file path '${fileName}'`);
        return;
    } else if (!isImageFileType(path.extname(fileName))) {
        console.log(`Skipping '${fileName}', not a known image file.`);
        return;
    }

    const img: image.Image | undefined = await image.loadImage(fileName, chatModel);

    if (image !== undefined) {
        return new Image([img!.title], new ImageMeta(fileName, img!));
    }

    return undefined;
}
