// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    conversation as kpLib,
    TextEmbeddingModelWithCache,
} from "knowledge-processor";
import * as kp from "knowpro";
import { createEmbeddingModel } from "./common.js";
import { queue, QueueObject } from "async";

export class ConversationMessage implements kp.IMessage {
    public textChunks: string[];
    public timestamp?: string | undefined;
    public deletionInfo?: kp.DeletionInfo | undefined;

    constructor(
        messageText: string,
        public knowledge?: kpLib.KnowledgeResponse,
        public tags: string[] = [],
    ) {
        this.textChunks = [messageText];
    }

    public getKnowledge(): kpLib.KnowledgeResponse | undefined {
        return this.knowledge;
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
    private updateQueue: QueueObject<AddMessageTask>;

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
        this.updateQueue = queue(() => this.processUpdates, 1);
    }

    public async addMessage(
        message: string | ConversationMessage,
        extractKnowledge: boolean = true,
    ): Promise<void> {
        if (typeof message === "string") {
            message = new ConversationMessage(message);
        }
        let startAtMessageOrdinal = this.messages.length;
        let startAtSemanticRefOrdinal = this.semanticRefs.length;

        this.messages.push(message);
        kp.addToConversationIndex(
            this,
            this.settings,
            startAtMessageOrdinal,
            startAtSemanticRefOrdinal,
        );
    }

    public queueAddMessage(
        message: string | ConversationMessage,
        extractKnowledge: boolean = true,
    ): void {
        if (typeof message === "string") {
            message = new ConversationMessage(message);
        }
        this.updateQueue.push({
            type: "addMessage",
            message,
            extractKnowledge,
        });
    }

    private processUpdates(task: AddMessageTask) {
        switch (task.type) {
            default:
                break;
            case "addMessage":
                this.addMessage(task.message, task.extractKnowledge);
                break;
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
        return settings;
    }
}

type AddMessageTask = {
    type: "addMessage";
    message: ConversationMessage;
    extractKnowledge?: boolean | boolean;
};

export interface ConversationMemoryData
    extends kp.IConversationDataWithIndexes<ConversationMessage> {}
