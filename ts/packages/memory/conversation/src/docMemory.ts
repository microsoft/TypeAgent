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

export class DocTextBlockMeta extends MessageMetadata {
    constructor(public sourceUrl?: string | undefined) {
        super();
    }
}

export class DocTextBlock extends Message {
    constructor(
        textChunks: string | string[],
        metadata?: DocTextBlockMeta | undefined,
        tags?: string[] | undefined,
        timestamp?: string,
        deletionInfo: kp.DeletionInfo | undefined = undefined,
    ) {
        metadata ??= new DocTextBlockMeta();
        tags ??= [];
        timestamp = timestamp ?? new Date().toISOString();
        super(metadata, textChunks, tags, timestamp, undefined, deletionInfo);
    }
}

export class DocTextBlockSerializer implements kp.JsonSerializer<DocTextBlock> {
    public serialize(value: DocTextBlock): string {
        return JSON.stringify(value);
    }

    public deserialize(json: string): DocTextBlock {
        const jMsg: DocTextBlock = JSON.parse(json);
        const jMeta: DocTextBlockMeta = jMsg.metadata;
        return new DocTextBlock(
            jMsg.textChunks,
            jMeta,
            jMsg.tags,
            jMsg.timestamp,
            jMsg.deletionInfo,
        );
    }
}

export interface DocMemorySettings extends MemorySettings {}

export function createTextMemorySettings() {
    return {
        ...createMemorySettings(),
    };
}

export class DocMemory
    extends Memory<DocMemorySettings, DocTextBlock>
    implements kp.IConversation
{
    public messages: kp.MessageCollection<DocTextBlock>;
    public semanticRefs: kp.ISemanticRefCollection;
    public semanticRefIndex: kp.ConversationIndex;
    public secondaryIndexes: kp.ConversationSecondaryIndexes;

    constructor(
        nameTag: string = "",
        textBlocks: DocTextBlock[],
        settings?: DocMemorySettings,
        tags?: string[],
    ) {
        super(settings ?? createTextMemorySettings(), nameTag, tags);
        this.messages = new kp.MessageCollection<DocTextBlock>(textBlocks);
        this.semanticRefs = new kp.SemanticRefCollection();

        this.semanticRefIndex = new kp.ConversationIndex();
        this.secondaryIndexes = new kp.ConversationSecondaryIndexes(
            this.settings.conversationSettings,
        );
    }

    public override get conversation(): kp.IConversation<DocTextBlock> {
        return this;
    }
}
