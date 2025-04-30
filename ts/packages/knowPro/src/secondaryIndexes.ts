// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IConversationThreadData } from "./conversationThread.js";
import { ConversationSettings } from "./conversation.js";
import {
    IConversation,
    IConversationData,
    IConversationSecondaryIndexes,
    IndexingEventHandlers,
    MessageOrdinal,
    SecondaryIndexingResults,
    SemanticRefOrdinal,
    Term,
} from "./interfaces.js";
import {
    addToMessageIndex,
    buildMessageIndex,
    IMessageTextIndexData,
    MessageTextIndex,
} from "./messageIndex.js";
import {
    PropertyIndex,
    addToPropertyIndex,
    buildPropertyIndex,
} from "./propertyIndex.js";
import {
    addToRelatedTermsIndex,
    buildRelatedTermsIndex,
    RelatedTermsIndex,
} from "./relatedTermsIndex.js";
import {
    addToTimestampIndex,
    buildTimestampIndex,
    TimestampToTextRangeIndex,
} from "./timestampIndex.js";

export async function buildSecondaryIndexes(
    conversation: IConversation,
    conversationSettings: ConversationSettings,
    eventHandler?: IndexingEventHandlers,
): Promise<SecondaryIndexingResults> {
    conversation.secondaryIndexes ??= new ConversationSecondaryIndexes(
        conversationSettings,
    );
    let result: SecondaryIndexingResults = buildTransientSecondaryIndexes(
        conversation,
        conversationSettings,
    );
    result.relatedTerms = await buildRelatedTermsIndex(
        conversation,
        conversationSettings.relatedTermIndexSettings,
        eventHandler,
    );
    if (!result.relatedTerms?.error) {
        result.message = await buildMessageIndex(
            conversation,
            conversationSettings.messageTextIndexSettings,
            eventHandler,
        );
    }

    return result;
}

export async function addToSecondaryIndexes(
    conversation: IConversation,
    conversationSettings: ConversationSettings,
    messageOrdinalStartAt: MessageOrdinal,
    semanticRefOrdinalStartAt: SemanticRefOrdinal,
    relatedTerms: string[],
    eventHandler?: IndexingEventHandlers,
): Promise<SecondaryIndexingResults> {
    conversation.secondaryIndexes ??= new ConversationSecondaryIndexes(
        conversationSettings,
    );
    let result: SecondaryIndexingResults = addToTransientSecondaryIndexes(
        conversation,
        conversationSettings,
        messageOrdinalStartAt,
        semanticRefOrdinalStartAt,
    );
    result.relatedTerms = await addToRelatedTermsIndex(
        conversation,
        conversationSettings.relatedTermIndexSettings,
        relatedTerms,
        eventHandler,
    );
    result.message = await addToMessageIndex(
        conversation,
        conversationSettings.messageTextIndexSettings,
        messageOrdinalStartAt,
        eventHandler,
    );
    return result;
}

/**
 * Some indexes are not persisted because they are cheap to rebuild on the fly
 * - Property index
 * - Timestamp index
 * @param conversation
 * @returns
 */
export function buildTransientSecondaryIndexes(
    conversation: IConversation,
    settings: ConversationSettings,
): SecondaryIndexingResults {
    conversation.secondaryIndexes ??= new ConversationSecondaryIndexes(
        settings,
    );
    const result: SecondaryIndexingResults = {};
    result.properties = buildPropertyIndex(conversation);
    result.timestamps = buildTimestampIndex(conversation);
    return result;
}

export function addToTransientSecondaryIndexes(
    conversation: IConversation,
    settings: ConversationSettings,
    baseMessageOrdinal: MessageOrdinal,
    baseSemanticRefOrdinal: SemanticRefOrdinal,
): SecondaryIndexingResults {
    conversation.secondaryIndexes ??= new ConversationSecondaryIndexes(
        settings,
    );
    const result: SecondaryIndexingResults = {};
    result.properties = addToPropertyIndex(
        conversation,
        baseSemanticRefOrdinal,
    );
    result.timestamps = addToTimestampIndex(conversation, baseMessageOrdinal);
    return result;
}

export class ConversationSecondaryIndexes
    implements IConversationSecondaryIndexes
{
    public propertyToSemanticRefIndex: PropertyIndex;
    public timestampIndex: TimestampToTextRangeIndex;
    public termToRelatedTermsIndex: RelatedTermsIndex;
    public messageIndex: MessageTextIndex | undefined;

    constructor(conversationSettings: ConversationSettings) {
        this.propertyToSemanticRefIndex = new PropertyIndex();
        this.timestampIndex = new TimestampToTextRangeIndex();
        this.termToRelatedTermsIndex = new RelatedTermsIndex(
            conversationSettings.relatedTermIndexSettings,
        );
        if (conversationSettings.messageTextIndexSettings) {
            this.messageIndex = new MessageTextIndex(
                conversationSettings.messageTextIndexSettings,
            );
        }
    }
}

export interface ITermsToRelatedTermsIndexData {
    aliasData?: ITermToRelatedTermsData | undefined;
    textEmbeddingData?: ITextEmbeddingIndexData | undefined;
}

export interface ITermToRelatedTermsData {
    relatedTerms?: ITermsToRelatedTermsDataItem[] | undefined;
}

export interface ITermsToRelatedTermsDataItem {
    termText: string;
    relatedTerms: Term[];
}

export interface ITextEmbeddingIndexData {
    textItems: string[];
    embeddings: Float32Array[];
}

export interface IConversationDataWithIndexes<TMessage = any>
    extends IConversationData<TMessage> {
    relatedTermsIndexData?: ITermsToRelatedTermsIndexData | undefined;
    threadData?: IConversationThreadData | undefined;
    messageIndexData?: IMessageTextIndexData | undefined;
}
