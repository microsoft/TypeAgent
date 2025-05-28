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

export class DocPartMeta extends MessageMetadata {
    constructor(public sourceUrl?: string | undefined) {
        super();
    }
}

/**
 * A part of a document.
 * Use tags to annotate headings, etc.
 */
export class DocPart extends Message {
    constructor(
        textChunks: string | string[],
        metadata?: DocPartMeta | undefined,
        tags?: string[] | undefined,
        timestamp?: string,
        deletionInfo: kp.DeletionInfo | undefined = undefined,
    ) {
        metadata ??= new DocPartMeta();
        tags ??= [];
        timestamp = timestamp ?? new Date().toISOString();
        super(metadata, textChunks, tags, timestamp, undefined, deletionInfo);
    }
}

export class DocPartSerializer implements kp.JsonSerializer<DocPart> {
    public serialize(value: DocPart): string {
        return JSON.stringify(value);
    }

    public deserialize(json: string): DocPart {
        const jMsg: DocPart = JSON.parse(json);
        const jMeta: DocPartMeta = jMsg.metadata;
        return new DocPart(
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
    extends Memory<DocMemorySettings, DocPart>
    implements kp.IConversation
{
    public messages: kp.MessageCollection<DocPart>;
    public semanticRefs: kp.ISemanticRefCollection;
    public semanticRefIndex: kp.ConversationIndex;
    public secondaryIndexes: kp.ConversationSecondaryIndexes;

    constructor(
        nameTag: string = "",
        textBlocks: DocPart[],
        settings?: DocMemorySettings,
        tags?: string[],
    ) {
        super(settings ?? createTextMemorySettings(), nameTag, tags);
        this.messages = new kp.MessageCollection<DocPart>(textBlocks);
        this.semanticRefs = new kp.SemanticRefCollection();

        this.semanticRefIndex = new kp.ConversationIndex();
        this.secondaryIndexes = new kp.ConversationSecondaryIndexes(
            this.settings.conversationSettings,
        );
    }

    public override get conversation(): kp.IConversation<DocPart> {
        return this;
    }
}
