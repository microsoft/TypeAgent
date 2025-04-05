// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IConversation,
    IMessage,
    IndexingResults,
    ITermToSemanticRefIndex,
    ITermToSemanticRefIndexData,
    ITermToSemanticRefIndexItem,
    Knowledge,
    KnowledgeType,
    MessageOrdinal,
    ScoredSemanticRefOrdinal,
    SemanticRef,
    SemanticRefOrdinal,
    TextIndexingResult,
    TextLocation,
    Topic,
} from "./interfaces.js";
import { IndexingEventHandlers } from "./interfaces.js";
import { conversation as kpLib } from "knowledge-processor";
import { openai } from "aiclient";
import { async } from "typeagent";
import {
    createKnowledgeExtractor,
    extractKnowledgeFromTextBatch,
    facetValueToString,
} from "./knowledge.js";
import { buildSecondaryIndexes } from "./secondaryIndexes.js";
import { ConversationSettings } from "./conversation.js";
import { getMessageChunkBatch, textRangeFromMessageChunk } from "./message.js";

export type KnowledgeValidator = (
    knowledgeType: KnowledgeType,
    knowledge: Knowledge,
) => boolean;

export function addMetadataToIndex(
    messages: IMessage[],
    semanticRefs: SemanticRef[],
    semanticRefIndex: ITermToSemanticRefIndex,
    knowledgeValidator?: KnowledgeValidator,
) {
    knowledgeValidator ??= defaultKnowledgeValidator;
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const knowledgeResponse = msg.getKnowledge();
        if (knowledgeResponse === undefined) {
            continue;
        }
        if (semanticRefIndex !== undefined) {
            for (const entity of knowledgeResponse.entities) {
                if (knowledgeValidator("entity", entity)) {
                    addEntityToIndex(entity, semanticRefs, semanticRefIndex, i);
                }
            }
            for (const action of knowledgeResponse.actions) {
                if (knowledgeValidator("action", action)) {
                    addActionToIndex(action, semanticRefs, semanticRefIndex, i);
                }
            }
            for (const topicResponse of knowledgeResponse.topics) {
                const topic: Topic = { text: topicResponse };
                if (knowledgeValidator("topic", topic)) {
                    addTopicToIndex(topic, semanticRefs, semanticRefIndex, i);
                }
            }
        }
    }
}

function defaultKnowledgeValidator(
    knowledgeType: KnowledgeType,
    knowledge: Knowledge,
) {
    return true;
}

export function addEntityToIndex(
    entity: kpLib.ConcreteEntity,
    semanticRefs: SemanticRef[],
    semanticRefIndex: ITermToSemanticRefIndex,
    messageOrdinal: MessageOrdinal,
    chunkOrdinal = 0,
) {
    const semanticRefOrdinal = semanticRefs.length;
    semanticRefs.push({
        semanticRefOrdinal,
        range: textRangeFromMessageChunk(messageOrdinal, chunkOrdinal),
        knowledgeType: "entity",
        knowledge: entity,
    });
    semanticRefIndex.addTerm(entity.name, semanticRefOrdinal);
    // add each type as a separate term
    for (const type of entity.type) {
        semanticRefIndex.addTerm(type, semanticRefOrdinal);
    }
    // add every facet name as a separate term
    if (entity.facets) {
        for (const facet of entity.facets) {
            addFacet(facet, semanticRefOrdinal, semanticRefIndex);
        }
    }
}

function addFacet(
    facet: kpLib.Facet | undefined,
    semanticRefOrdinal: SemanticRefOrdinal,
    semanticRefIndex: ITermToSemanticRefIndex,
) {
    if (facet !== undefined) {
        semanticRefIndex.addTerm(facet.name, semanticRefOrdinal);
        if (facet.value !== undefined) {
            semanticRefIndex.addTerm(
                facetValueToString(facet),
                semanticRefOrdinal,
            );
        }
    }
}

export function addTopicToIndex(
    topic: Topic,
    semanticRefs: SemanticRef[],
    semanticRefIndex: ITermToSemanticRefIndex,
    messageOrdinal: MessageOrdinal,
    chunkOrdinal = 0,
) {
    const semanticRefOrdinal = semanticRefs.length;
    semanticRefs.push({
        semanticRefOrdinal,
        range: textRangeFromMessageChunk(messageOrdinal, chunkOrdinal),
        knowledgeType: "topic",
        knowledge: topic,
    });
    semanticRefIndex.addTerm(topic.text, semanticRefOrdinal);
}

export function addActionToIndex(
    action: kpLib.Action,
    semanticRefs: SemanticRef[],
    semanticRefIndex: ITermToSemanticRefIndex,
    messageOrdinal: MessageOrdinal,
    chunkOrdinal = 0,
) {
    const semanticRefOrdinal = semanticRefs.length;
    semanticRefs.push({
        semanticRefOrdinal,
        range: textRangeFromMessageChunk(messageOrdinal, chunkOrdinal),
        knowledgeType: "action",
        knowledge: action,
    });
    semanticRefIndex.addTerm(action.verbs.join(" "), semanticRefOrdinal);
    if (action.subjectEntityName !== "none") {
        semanticRefIndex.addTerm(action.subjectEntityName, semanticRefOrdinal);
    }
    if (action.objectEntityName !== "none") {
        semanticRefIndex.addTerm(action.objectEntityName, semanticRefOrdinal);
    }
    if (action.indirectObjectEntityName !== "none") {
        semanticRefIndex.addTerm(
            action.indirectObjectEntityName,
            semanticRefOrdinal,
        );
    }
    if (action.params) {
        for (const param of action.params) {
            if (typeof param === "string") {
                semanticRefIndex.addTerm(param, semanticRefOrdinal);
            } else {
                semanticRefIndex.addTerm(param.name, semanticRefOrdinal);
                if (typeof param.value === "string") {
                    semanticRefIndex.addTerm(param.value, semanticRefOrdinal);
                }
            }
        }
    }
    addFacet(action.subjectEntityFacet, semanticRefOrdinal, semanticRefIndex);
}

function addKnowledgeToIndex(
    conversation: IConversation,
    messageOrdinal: MessageOrdinal,
    chunkOrdinal: number,
    knowledge: kpLib.KnowledgeResponse,
): void {
    verifyHasSemanticRefIndex(conversation);

    const semanticRefs = conversation.semanticRefs!;
    const semanticRefIndex = conversation.semanticRefIndex!;
    for (const entity of knowledge.entities) {
        addEntityToIndex(
            entity,
            semanticRefs,
            semanticRefIndex,
            messageOrdinal,
            chunkOrdinal,
        );
    }
    for (const action of knowledge.actions) {
        addActionToIndex(
            action,
            semanticRefs,
            semanticRefIndex,
            messageOrdinal,
            chunkOrdinal,
        );
    }
    for (const inverseAction of knowledge.inverseActions) {
        addActionToIndex(
            inverseAction,
            semanticRefs,
            semanticRefIndex,
            messageOrdinal,
            chunkOrdinal,
        );
    }
    for (const topic of knowledge.topics) {
        const topicObj: Topic = { text: topic };
        addTopicToIndex(
            topicObj,
            semanticRefs,
            semanticRefIndex,
            messageOrdinal,
            chunkOrdinal,
        );
    }
}

export async function buildSemanticRefIndex(
    conversation: IConversation,
    extractor?: kpLib.KnowledgeExtractor,
    eventHandler?: IndexingEventHandlers,
): Promise<TextIndexingResult> {
    beginIndexing(conversation);

    extractor ??= createKnowledgeExtractor();
    const maxRetries = 4;
    let indexingResult: TextIndexingResult = {};
    for (let i = 0; i < conversation.messages.length; i++) {
        let messageOrdinal: MessageOrdinal = i;
        const chunkOrdinal = 0;
        const message = conversation.messages[messageOrdinal];
        // only one chunk per message for now
        const text = message.textChunks[chunkOrdinal].trim();
        const knowledgeResult = await async.callWithRetry(() =>
            extractor.extractWithRetry(text, maxRetries),
        );
        if (!knowledgeResult.success) {
            indexingResult.error = knowledgeResult.message;
            break;
        }
        const knowledge = knowledgeResult.data;
        if (knowledge) {
            addKnowledgeToIndex(
                conversation,
                messageOrdinal,
                chunkOrdinal,
                knowledge,
            );
        }
        const completedChunk: TextLocation = {
            messageOrdinal,
            chunkOrdinal,
        };
        indexingResult.completedUpto = completedChunk;
        if (
            eventHandler?.onKnowledgeExtracted &&
            !eventHandler.onKnowledgeExtracted(completedChunk, knowledge)
        ) {
            break;
        }
    }
    return indexingResult;
}

export async function buildSemanticRefIndexBatched(
    conversation: IConversation,
    batchSize: number,
    knowledgeExtractor?: kpLib.KnowledgeExtractor,
    eventHandler?: IndexingEventHandlers,
): Promise<TextIndexingResult> {
    beginIndexing(conversation);

    knowledgeExtractor ??= createKnowledgeExtractor();
    return addToSemanticRefIndex(
        conversation,
        0,
        batchSize,
        knowledgeExtractor,
        eventHandler,
    );
}

export async function addToSemanticRefIndex(
    conversation: IConversation,
    messageOrdinalStartAt: MessageOrdinal,
    batchSize: number,
    knowledgeExtractor: kpLib.KnowledgeExtractor,
    eventHandler?: IndexingEventHandlers,
    maxRetries: number = 3,
): Promise<TextIndexingResult> {
    let indexingResult: TextIndexingResult | undefined;
    for (const textLocationBatch of getMessageChunkBatch(
        conversation.messages,
        messageOrdinalStartAt,
        batchSize,
    )) {
        indexingResult = await addBatchToSemanticRefIndex(
            conversation,
            textLocationBatch,
            knowledgeExtractor,
            eventHandler,
            maxRetries,
        );
        if (indexingResult.error !== undefined) {
            break;
        }
    }
    return indexingResult ?? {};
}

async function addBatchToSemanticRefIndex(
    conversation: IConversation,
    batch: TextLocation[],
    knowledgeExtractor: kpLib.KnowledgeExtractor,
    eventHandler?: IndexingEventHandlers,
    maxRetries: number = 3,
): Promise<TextIndexingResult> {
    beginIndexing(conversation);

    const messages = conversation.messages;
    let indexingResult: TextIndexingResult = {};

    const textBatch = batch.map((tl) => {
        const text =
            messages[tl.messageOrdinal].textChunks[tl.chunkOrdinal ?? 0];
        return text.trim();
    });
    const knowledgeResults = await extractKnowledgeFromTextBatch(
        knowledgeExtractor,
        textBatch,
        textBatch.length,
        maxRetries,
    );
    for (let i = 0; i < knowledgeResults.length; ++i) {
        const knowledgeResult = knowledgeResults[i];
        if (!knowledgeResult.success) {
            indexingResult.error = knowledgeResult.message;
            return indexingResult;
        }
        const textLocation = batch[i];
        const knowledge = knowledgeResult.data;
        addKnowledgeToIndex(
            conversation,
            textLocation.messageOrdinal,
            textLocation.charOrdinal ?? 0,
            knowledge,
        );
        indexingResult.completedUpto = textLocation;
        if (
            eventHandler?.onKnowledgeExtracted &&
            !eventHandler.onKnowledgeExtracted(textLocation, knowledge)
        ) {
            break;
        }
    }
    return indexingResult;
}

/**
 * Appends the given messages and their associated knowledge to the conversation index
 * @param conversation
 * @param messages
 * @param knowledgeResponses
 */
export function addToConversation(
    conversation: IConversation,
    messages: IMessage[],
    knowledgeResponses: kpLib.KnowledgeResponse[],
): void {
    beginIndexing(conversation);
    for (let i = 0; i < messages.length; i++) {
        const messageOrdinal: MessageOrdinal = conversation.messages.length;
        const chunkOrdinal = 0;
        conversation.messages.push(messages[i]);
        const knowledge = knowledgeResponses[i];
        if (knowledge) {
            addKnowledgeToIndex(
                conversation,
                messageOrdinal,
                chunkOrdinal,
                knowledge,
            );
        }
    }
}

function beginIndexing(conversation: IConversation) {
    if (conversation.semanticRefIndex === undefined) {
        conversation.semanticRefIndex = new ConversationIndex();
    }
    if (conversation.semanticRefs === undefined) {
        conversation.semanticRefs = [];
    }
}

function verifyHasSemanticRefIndex(conversation: IConversation) {
    if (
        conversation.secondaryIndexes === undefined ||
        conversation.semanticRefs === undefined
    ) {
        throw new Error("Conversation does not have an index");
    }
}
/**
 * Notes:
 *  Case-insensitive
 */
export class ConversationIndex implements ITermToSemanticRefIndex {
    private map: Map<string, ScoredSemanticRefOrdinal[]> = new Map();

    constructor(data?: ITermToSemanticRefIndexData | undefined) {
        if (data !== undefined) {
            this.deserialize(data);
        }
    }

    get size(): number {
        return this.map.size;
    }

    public getTerms(): string[] {
        return [...this.map.keys()];
    }

    public addTerm(
        term: string,
        semanticRefIndex: SemanticRefOrdinal | ScoredSemanticRefOrdinal,
    ): void {
        if (!term) {
            return;
        }
        if (typeof semanticRefIndex === "number") {
            semanticRefIndex = {
                semanticRefOrdinal: semanticRefIndex,
                score: 1,
            };
        }
        term = this.prepareTerm(term);
        const existing = this.map.get(term);
        if (existing != undefined) {
            existing.push(semanticRefIndex);
        } else {
            this.map.set(term, [semanticRefIndex]);
        }
    }

    lookupTerm(term: string): ScoredSemanticRefOrdinal[] {
        return this.map.get(this.prepareTerm(term)) ?? [];
    }

    removeTerm(term: string, semanticRefIndex: number): void {
        this.map.delete(this.prepareTerm(term));
    }

    removeTermIfEmpty(term: string): void {
        term = this.prepareTerm(term);
        if (this.map.has(term) && this.map.get(term)?.length === 0) {
            this.map.delete(term);
        }
    }

    serialize(): ITermToSemanticRefIndexData {
        const items: ITermToSemanticRefIndexItem[] = [];
        for (const [term, semanticRefOrdinals] of this.map) {
            items.push({ term, semanticRefOrdinals });
        }
        return { items };
    }

    deserialize(data: ITermToSemanticRefIndexData): void {
        for (const termData of data.items) {
            if (termData && termData.term) {
                this.map.set(
                    this.prepareTerm(termData.term),
                    termData.semanticRefOrdinals,
                );
            }
        }
    }

    /**
     * Do any pre-processing of the term.
     * @param term
     */
    private prepareTerm(term: string): string {
        return term.toLowerCase();
    }
}

export function createKnowledgeModel() {
    const chatModelSettings = openai.apiSettingsFromEnv(
        openai.ModelType.Chat,
        undefined,
        "GPT_4_O",
    );
    chatModelSettings.retryPauseMs = 10000;
    const chatModel = openai.createJsonChatModel(chatModelSettings, [
        "chatExtractor",
    ]);
    return chatModel;
}

export async function buildConversationIndex(
    conversation: IConversation,
    conversationSettings: ConversationSettings,
    eventHandler?: IndexingEventHandlers,
    batchSize: number = 2,
): Promise<IndexingResults> {
    const indexingResult: IndexingResults = {};
    indexingResult.semanticRefs = await buildSemanticRefIndexBatched(
        conversation,
        batchSize,
        undefined,
        eventHandler,
    );
    if (!indexingResult.semanticRefs?.error && conversation.semanticRefIndex) {
        indexingResult.secondaryIndexResults = await buildSecondaryIndexes(
            conversation,
            conversationSettings,
            eventHandler,
        );
    }
    return indexingResult;
}
