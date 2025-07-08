// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversation as kpLib } from "knowledge-processor";
import * as kp from "knowpro";
import { queue, QueueObject } from "async";
import { parseTranscript } from "./transcript.js";
import registerDebug from "debug";
import { error, Result, success } from "typechat";
import {
    createMemorySettings,
    IndexFileSettings,
    Memory,
    MemorySettings,
    Message,
    MessageMetadata,
} from "./memory.js";
const debugLogger = registerDebug("conversation-memory.conversation");

export class ConversationMessageMeta extends MessageMetadata {
    constructor(
        public sender?: string | undefined,
        public recipients?: string[] | undefined,
    ) {
        super();
    }

    public override get source() {
        return this.sender;
    }

    public override get dest() {
        return this.recipients;
    }

    public getKnowledge(): kpLib.KnowledgeResponse | undefined {
        if (this.sender) {
            const entities: kpLib.ConcreteEntity[] = [];
            const actions: kpLib.Action[] = [];
            const inverseActions: kpLib.Action[] = [];
            if (this.sender) {
                entities.push({
                    name: this.sender,
                    type: ["person"],
                });
            }
            if (this.recipients && this.recipients.length > 0) {
                for (const recipient of this.recipients) {
                    entities.push({
                        name: recipient,
                        type: ["person"],
                    });
                }
                for (const recipient of this.recipients) {
                    const action: kpLib.Action = {
                        verbs: ["send"],
                        verbTense: "past",
                        subjectEntityName: this.sender,
                        objectEntityName: recipient,
                        indirectObjectEntityName: "none",
                    };
                    actions.push(action);
                    const inverseAction: kpLib.Action = {
                        verbs: ["receive"],
                        verbTense: "past",
                        subjectEntityName: recipient,
                        objectEntityName: this.sender,
                        indirectObjectEntityName: "none",
                    };
                    inverseActions.push(inverseAction);
                }
            }
            return {
                entities,
                actions,
                inverseActions,
                topics: [],
            };
        }
        return undefined;
    }
}

export class ConversationMessage extends Message<ConversationMessageMeta> {
    constructor(
        messageText: string | string[],
        metadata?: ConversationMessageMeta | undefined,
        tags?: string[] | undefined,
        /**
         * Any pre-extracted knowledge for this message.
         */
        knowledge?: kpLib.KnowledgeResponse,
        timestamp?: string,
    ) {
        metadata ??= new ConversationMessageMeta();
        tags ??= [];
        timestamp = timestamp ?? new Date().toISOString();
        super(metadata, messageText, tags, timestamp, knowledge);
    }
}

export type ConversationMemorySettings = MemorySettings;

/**
 * A memory of conversation messages {@link ConversationMessage}
 * Extends the {@link Memory} class with functionality specific to Conversations
 * @see {@link Memory} for base methods such as search and answer.
 */
export class ConversationMemory
    extends Memory<ConversationMemorySettings, ConversationMessage>
    implements kp.IConversation<ConversationMessage>
{
    public messages: kp.MessageCollection<ConversationMessage>;
    public semanticRefIndex: kp.ConversationIndex;
    public secondaryIndexes: kp.ConversationSecondaryIndexes;
    public semanticRefs: kp.SemanticRefCollection;

    private updatesTaskQueue: QueueObject<ConversationMemoryTasks>;

    constructor(
        nameTag: string = "",
        messages: ConversationMessage[] = [],
        tags: string[] = [],
        settings?: ConversationMemorySettings,
    ) {
        settings ??= createMemorySettings(
            64,
            () => this.secondaryIndexes.termToRelatedTermsIndex.fuzzyIndex,
        );
        super(settings, nameTag, tags);
        this.adjustSettings();
        this.messages = new kp.MessageCollection<ConversationMessage>(messages);
        this.semanticRefs = new kp.SemanticRefCollection();

        this.semanticRefIndex = new kp.ConversationIndex();
        this.secondaryIndexes = new kp.ConversationSecondaryIndexes(
            this.settings.conversationSettings,
        );
        this.updatesTaskQueue = this.createTaskQueue();
    }

    public override get conversation(): kp.IConversation<ConversationMessage> {
        return this;
    }

    /**
     * Add a new conversation message to this conversation memory
     * @param {ConversationMessage} message message to add
     * @param extractKnowledge Extract knowledge from message text
     * @param retainKnowledge if false, any message.knowledge is cleared after indexing
     * @returns Any extracted knowledge
     */
    public async addMessage(
        message: ConversationMessage,
        extractKnowledge: boolean = true,
        retainKnowledge: boolean = false,
    ): Promise<Result<kpLib.KnowledgeResponse | undefined>> {
        //
        // Messages can contain prior knowledge extracted during chat responses for example
        // To avoid knowledge duplication, we:
        // - (a) Manually extract knowledge from the message
        // - (b) merge it with any prior knowledge
        // - (c) Surface the combined knowledge from the IMessage.getKnowledge implementation
        // - (d) configure the indexing engine not to automatically extract any other knowledge
        //
        let messageKnowledge: kpLib.KnowledgeResponse | undefined;
        if (extractKnowledge) {
            const knowledgeResult = await kp.extractKnowledgeFromText(
                this.settings.conversationSettings.semanticRefIndexSettings
                    .knowledgeExtractor!,
                message.textChunks[0].trim(),
                3,
            );
            if (!knowledgeResult.success) {
                return knowledgeResult;
            }
            // This will merge the new knowledge with the prior knowledge
            messageKnowledge = message.addKnowledge(knowledgeResult.data);
        }

        // Now, add the message to memory and index it
        let messageOrdinalStartAt = this.messages.length;
        let semanticRefOrdinalStartAt = this.semanticRefs.length;
        this.messages.append(message);

        try {
            this.beginIndexing();

            await kp.addToConversationIndex(
                this,
                this.settings.conversationSettings,
                messageOrdinalStartAt,
                semanticRefOrdinalStartAt,
            );

            if (retainKnowledge === false) {
                // Clear knowledge, now that it was indexed
                message.knowledge = undefined;
            }

            const saveResult = await this.autoSaveFile();
            if (!saveResult.success) {
                return saveResult;
            }
            return success(messageKnowledge);
        } finally {
            this.endIndexing();
        }
    }

    /**
     * Queue a message for adding to this conversation memory as a background task
     * @param {ConversationMessage} message message to add
     * @param extractKnowledge Extract knowledge from message text
     * @param retainKnowledge if false, any message.knowledge is cleared after indexing
     * @returns Any extracted knowledge
     */
    public queueAddMessage(
        message: ConversationMessage,
        completionCallback?: ConversationTaskCallback,
        extractKnowledge: boolean = true,
        retainKnowledge: boolean = false,
    ): void {
        this.updatesTaskQueue.push({
            type: "addMessage",
            message,
            callback: completionCallback,
            extractKnowledge,
            retainKnowledge,
        });
    }

    public async waitForPendingTasks(): Promise<void> {
        await this.updatesTaskQueue.drain();
    }

    public async serialize(): Promise<ConversationMemoryData> {
        const data: ConversationMemoryData = {
            nameTag: this.nameTag,
            messages: this.messages.getAll(),
            tags: this.tags,
            semanticRefs: this.semanticRefs.getAll(),
            semanticIndexData: this.semanticRefIndex?.serialize(),
            relatedTermsIndexData:
                this.secondaryIndexes.termToRelatedTermsIndex.serialize(),
            messageIndexData: this.secondaryIndexes.messageIndex?.serialize(),
        };
        return data;
    }

    public async deserialize(data: ConversationMemoryData): Promise<void> {
        this.nameTag = data.nameTag;
        this.messages = this.deserializeMessages(data);
        this.semanticRefs = new kp.SemanticRefCollection(data.semanticRefs);
        this.tags = data.tags;
        if (data.semanticIndexData) {
            this.semanticRefIndex = new kp.ConversationIndex(
                data.semanticIndexData,
            );
        }
        if (data.relatedTermsIndexData) {
            this.secondaryIndexes.termToRelatedTermsIndex.deserialize(
                data.relatedTermsIndexData,
            );
        }
        if (data.messageIndexData) {
            this.secondaryIndexes.messageIndex = new kp.MessageTextIndex(
                this.settings.conversationSettings.messageTextIndexSettings,
            );
            this.secondaryIndexes.messageIndex.deserialize(
                data.messageIndexData,
            );
        }
        // Rebuild transient secondary indexes associated with the conversation
        await kp.buildTransientSecondaryIndexes(
            this,
            this.settings.conversationSettings,
        );
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
    ): Promise<ConversationMemory | undefined> {
        const memory = new ConversationMemory();
        const data = await kp.readConversationDataFromFile(
            dirPath,
            baseFileName,
            memory.settings.conversationSettings.relatedTermIndexSettings
                .embeddingIndexSettings?.embeddingSize,
        );
        if (data) {
            memory.deserialize(data);
        }
        return memory;
    }

    private async autoSaveFile(): Promise<Result<boolean>> {
        try {
            const fileSaveSettings = this.settings.fileSaveSettings;
            if (fileSaveSettings) {
                // TODO: Optionally, back up previous file and do a safe read write
                await this.writeToFile(
                    fileSaveSettings.dirPath,
                    fileSaveSettings.baseFileName,
                );
            }
            return success(true);
        } catch (ex) {
            return error(`AutoSaveFile failed ${ex}`);
        }
    }

    private deserializeMessages(memoryData: ConversationMemoryData) {
        const messages = memoryData.messages.map((m) => {
            const metadata = new ConversationMessageMeta(m.metadata.sender);
            metadata.recipients = m.metadata.recipients;
            return new ConversationMessage(
                m.textChunks,
                metadata,
                m.tags,
                undefined,
                m.timestamp,
            );
        });
        return new kp.MessageCollection<ConversationMessage>(messages);
    }

    private createTaskQueue() {
        return queue(async (task: ConversationMemoryTasks, callback) => {
            try {
                await this.processUpdates(task);
                callback();
            } catch (ex: any) {
                callback(ex);
            }
        }, 1);
    }

    private async processUpdates(task: ConversationMemoryTasks) {
        let callback: ConversationTaskCallback | undefined;
        try {
            switch (task.type) {
                default:
                    break;
                case "addMessage":
                    callback = task.callback;
                    const result = await this.addMessage(
                        task.message,
                        task.extractKnowledge,
                        task.retainKnowledge,
                    );
                    if (callback) {
                        if (result.success) {
                            callback();
                        } else {
                            callback(result.message);
                        }
                    }
                    break;
            }
        } catch (ex) {
            debugLogger(`processUpdates failed: ${ex}`);
            if (callback) {
                callback(ex);
            }
        }
    }

    protected override getPersistentEmbeddingCache() {
        return this.secondaryIndexes.termToRelatedTermsIndex.fuzzyIndex;
    }

    private adjustSettings(): void {
        //
        // Messages can contain prior knowledge extracted during chat responses for example
        // To avoid knowledge duplication, we manually extract message knowledge and merge it
        // with any prior knowledge
        //
        this.settings.conversationSettings.semanticRefIndexSettings.autoExtractKnowledge =
            false;
    }
}

export async function createConversationMemory(
    fileSettings: IndexFileSettings,
    createNew: boolean,
): Promise<ConversationMemory> {
    let cm: ConversationMemory | undefined;
    if (createNew) {
        await kp.removeConversationData(
            fileSettings.dirPath,
            fileSettings.baseFileName,
        );
    }
    cm = await ConversationMemory.readFromFile(
        fileSettings.dirPath,
        fileSettings.baseFileName,
    );
    if (!cm) {
        cm = new ConversationMemory();
    }
    cm.settings.fileSaveSettings = fileSettings;
    return cm;
}

export type ConversationTaskCallback =
    | ((error?: any | undefined) => void)
    | undefined;

type AddMessageTask = {
    type: "addMessage";
    message: ConversationMessage;
    callback?: ConversationTaskCallback;
    extractKnowledge: boolean;
    retainKnowledge: boolean;
};

type ConversationMemoryTasks = AddMessageTask;

export interface ConversationMemoryData
    extends kp.IConversationDataWithIndexes<ConversationMessage> {}

export function parseConversationMemoryTranscript(
    transcriptText: string,
): [ConversationMessage[], Set<string>] {
    const [messages, participants] = parseTranscript(
        transcriptText,
        (sender, messageText) =>
            new ConversationMessage(
                messageText,
                new ConversationMessageMeta(sender),
            ),
    );
    assignMessageRecipients(messages, participants);
    return [messages, participants];
}

function assignMessageRecipients(
    msgs: ConversationMessage[],
    participants: Set<string>,
) {
    for (const msg of msgs) {
        if (msg.metadata.sender) {
            let recipients: string[] = [];
            for (const p of participants) {
                if (p !== msg.metadata.sender) {
                    recipients.push(p);
                }
            }
            msg.metadata.recipients = recipients;
        }
    }
}
