// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    conversation as kpLib,
    TextEmbeddingModelWithCache,
} from "knowledge-processor";
import * as kp from "knowpro";
import { createEmbeddingModel } from "./common.js";
import { queue, QueueObject } from "async";
import { parseTranscript } from "./transcript.js";

import registerDebug from "debug";
import { Result, success } from "typechat";
const debugLogger = registerDebug("conversation-memory.podcast");

export class ConversationMessageMeta implements kp.IKnowledgeSource {
    constructor(
        public sender?: string | undefined,
        public recipients?: string[] | undefined,
    ) {}

    getKnowledge(): kpLib.KnowledgeResponse | undefined {
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

export class ConversationMessage implements kp.IMessage {
    public textChunks: string[];
    public timestamp: string;
    public deletionInfo?: kp.DeletionInfo | undefined;

    constructor(
        messageText: string | string[],
        public metadata: ConversationMessageMeta,
        /**
         * Any pre-extracted knowledge for this message.
         */
        public knowledge?: kpLib.KnowledgeResponse,
        timestamp?: string,
        public tags: string[] = [],
    ) {
        this.textChunks = Array.isArray(messageText)
            ? messageText
            : [messageText];
        this.timestamp = timestamp ?? new Date().toISOString();
    }

    public addContent(content: string, chunkOrdinal = 0) {
        if (chunkOrdinal > this.textChunks.length) {
            this.textChunks.push(content);
        } else {
            this.textChunks[chunkOrdinal] += content;
        }
    }

    public addKnowledge(newKnowledge: kpLib.KnowledgeResponse): void {
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
    }

    public getKnowledge(): kpLib.KnowledgeResponse | undefined {
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

export class ConversationMemory
    implements kp.IConversation<ConversationMessage>
{
    public settings: kp.ConversationSettings;
    public semanticRefIndex: kp.ConversationIndex;
    public secondaryIndexes: kp.ConversationSecondaryIndexes;
    public semanticRefs: kp.SemanticRef[];

    private embeddingModel: TextEmbeddingModelWithCache | undefined;
    private embeddingSize: number | undefined;
    private updatesTaskQueue: QueueObject<ConversationMemoryTasks>;

    constructor(
        public nameTag: string = "",
        public messages: ConversationMessage[] = [],
        public tags: string[] = [],
        settings?: kp.ConversationSettings,
    ) {
        this.semanticRefs = [];
        if (!settings) {
            settings = this.createSettings();
        }
        this.settings = settings;
        this.semanticRefIndex = new kp.ConversationIndex();
        this.secondaryIndexes = new kp.ConversationSecondaryIndexes(
            this.settings,
        );
        this.updatesTaskQueue = queue(() => this.processUpdates, 1);
    }

    public async addMessage(
        message: ConversationMessage,
    ): Promise<Result<kpLib.KnowledgeResponse>> {
        //
        // Messages can contain prior knowledge extracted during chat responses for example
        // To avoid knowledge duplication, we:
        // - (a) Manually extract knowledge from the message
        // - (b) merge it with any prior knowledge
        // - (c) Surface the combined knowledge from the IMessage.getKnowledge implementation
        // - (d) configure the indexing engine not to automatically extract any other knowledge
        //
        const knowledgeResult = await kp.extractKnowledgeFromText(
            this.settings.semanticRefIndexSettings.knowledgeExtractor!,
            message.textChunks[0],
            3,
        );
        if (!knowledgeResult.success) {
            return knowledgeResult;
        }
        // This will merge the new knowledge with the prior knowledge
        message.addKnowledge(knowledgeResult.data);
        let messageOrdinalStartAt = this.messages.length;
        let semanticRefOrdinalStartAt = this.semanticRefs.length;

        this.messages.push(message);
        kp.addToConversationIndex(
            this,
            this.settings,
            messageOrdinalStartAt,
            semanticRefOrdinalStartAt,
        );
        return success(message.knowledge!);
    }

    public queueAddMessage(message: ConversationMessage): void {
        this.updatesTaskQueue.push({
            type: "addMessage",
            message,
        });
    }

    private async processUpdates(task: AddMessageTask) {
        let callback: ((error?: any | undefined) => void) | undefined;
        try {
            switch (task.type) {
                default:
                    break;
                case "addMessage":
                    const result = await this.addMessage(task.message);
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
        const settings = kp.createConversationSettings(
            this.embeddingModel,
            this.embeddingSize,
        );
        settings.semanticRefIndexSettings.knowledgeExtractor =
            kp.createKnowledgeExtractor();
        // Messages can contain prior knowledge extracted during chat responses for example
        // To avoid knowledge duplication, we manually extract message knowledge and merge it
        // with any prior knowledge
        settings.semanticRefIndexSettings.autoExtractKnowledge = false;
        return settings;
    }
}

type AddMessageTask = {
    type: "addMessage";
    message: ConversationMessage;
    callback?: ((error?: any | undefined) => void) | undefined;
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
