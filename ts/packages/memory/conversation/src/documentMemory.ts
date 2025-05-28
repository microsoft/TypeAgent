// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import {
    createMemorySettings,
    Memory,
    MemorySettings,
    Message,
    MessageMetadata,
} from "./memory.js";

export class TextBlockMeta extends MessageMetadata {
    constructor(public sourceUrl?: string | undefined) {
        super();
    }
}

export class TextBlock extends Message {
    constructor(
        textChunks: string | string[],
        metadata?: TextBlockMeta | undefined,
        tags?: string[] | undefined,
        timestamp?: string,
        deletionInfo: kp.DeletionInfo | undefined = undefined,
    ) {
        metadata ??= new TextBlockMeta();
        tags ??= [];
        timestamp = timestamp ?? new Date().toISOString();
        super(metadata, textChunks, tags, timestamp, undefined, deletionInfo);
    }
}

export class TextBlockSerializer implements kp.JsonSerializer<TextBlock> {
    public serialize(value: TextBlock): string {
        return JSON.stringify(value);
    }

    public deserialize(json: string): TextBlock {
        const jMsg: TextBlock = JSON.parse(json);
        const jMeta: TextBlockMeta = jMsg.metadata;
        return new TextBlock(
            jMsg.textChunks,
            jMeta,
            jMsg.tags,
            jMsg.timestamp,
            jMsg.deletionInfo,
        );
    }
}

export interface DocumentMemorySettings extends MemorySettings {}

export function createTextMemorySettings() {
    return {
        ...createMemorySettings(),
    };
}

export class DocumentMemory
    extends Memory<DocumentMemorySettings, TextBlock>
    implements kp.IConversation
{
    public messages: kp.IMessageCollection<TextBlock>;
    public semanticRefs: kp.ISemanticRefCollection;
    public semanticRefIndex: kp.ConversationIndex;
    public secondaryIndexes: kp.ConversationSecondaryIndexes;

    constructor(
        storageProvider: kp.IStorageProvider,
        settings?: DocumentMemorySettings,
        name?: string,
        tags?: string[],
    ) {
        super(settings ?? createTextMemorySettings(), name, tags);
        this.messages = storageProvider.createMessageCollection();
        this.semanticRefs = storageProvider.createSemanticRefCollection();

        this.semanticRefIndex = new kp.ConversationIndex();
        this.secondaryIndexes = new kp.ConversationSecondaryIndexes(
            this.settings.conversationSettings,
        );
    }

    public override get conversation(): kp.IConversation<TextBlock> {
        return this;
    }
}
