// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversation as kpLib } from "knowledge-processor";
import * as kp from "knowpro";
import {
    ConversationSettings,
    DeletionInfo,
    IConversation,
    IConversationSecondaryIndexes,
    IMessage,
    ITermToSemanticRefIndex,
    SemanticRef,
} from "knowpro";

export class ConversationMessage implements IMessage {
    public textChunks: string[];
    public timestamp?: string | undefined;
    public deletionInfo?: DeletionInfo | undefined;

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

export class ConversationMemory implements IConversation<ConversationMessage> {
    public semanticRefs: SemanticRef[] | undefined;
    public semanticRefIndex?: ITermToSemanticRefIndex | undefined;
    public secondaryIndexes?: IConversationSecondaryIndexes | undefined;

    constructor(
        public nameTag: string = "",
        public messages: ConversationMessage[] = [],
        public tags: string[] = [],
        public settings?: ConversationSettings,
    ) {
        this.semanticRefs = [];
        if (!settings) {
            settings = kp.createConversationSettings();
        }
        this.settings = settings;
        this.semanticRefIndex = new kp.ConversationIndex();
        this.secondaryIndexes = new kp.ConversationSecondaryIndexes(
            this.settings,
        );
    }
}
