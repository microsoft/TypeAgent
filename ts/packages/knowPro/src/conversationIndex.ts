// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IConversation,
    IKnowledgeSource,
    IMessage,
    IndexingResults,
    ITermToSemanticRefIndex,
    ITermToSemanticRefIndexData,
    ITermToSemanticRefIndexItem,
    Knowledge,
    KnowledgeType,
    MessageIndex,
    ScoredSemanticRef,
    SemanticRef,
    SemanticRefIndex,
    TextRange,
    Topic,
} from "./interfaces.js";
import { IndexingEventHandlers } from "./interfaces.js";
import { conversation as kpLib } from "knowledge-processor";
import { ChatModel, openai } from "aiclient";
import { async } from "typeagent";
import { facetValueToString } from "./knowledge.js";
import { buildSecondaryIndexes } from "./secondaryIndexes.js";

export function textRangeFromLocation(
    messageIndex: MessageIndex,
    chunkIndex = 0,
): TextRange {
    return {
        start: { messageIndex, chunkIndex },
        end: undefined,
    };
}

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
        const knowledgeResponse = msg.metadata.getKnowledge();
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
            for (const topic of knowledgeResponse.topics) {
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
    messageIndex: number,
    chunkIndex = 0,
) {
    const refIndex = semanticRefs.length;
    semanticRefs.push({
        semanticRefIndex: refIndex,
        range: textRangeFromLocation(messageIndex, chunkIndex),
        knowledgeType: "entity",
        knowledge: entity,
    });
    semanticRefIndex.addTerm(entity.name, refIndex);
    // add each type as a separate term
    for (const type of entity.type) {
        semanticRefIndex.addTerm(type, refIndex);
    }
    // add every facet name as a separate term
    if (entity.facets) {
        for (const facet of entity.facets) {
            addFacet(facet, refIndex, semanticRefIndex);
        }
    }
}

function addFacet(
    facet: kpLib.Facet | undefined,
    refIndex: number,
    semanticRefIndex: ITermToSemanticRefIndex,
) {
    if (facet !== undefined) {
        semanticRefIndex.addTerm(facet.name, refIndex);
        if (facet.value !== undefined) {
            semanticRefIndex.addTerm(facetValueToString(facet), refIndex);
        }
    }
}

export function addTopicToIndex(
    topic: Topic,
    semanticRefs: SemanticRef[],
    semanticRefIndex: ITermToSemanticRefIndex,
    messageIndex: number,
    chunkIndex = 0,
) {
    const refIndex = semanticRefs.length;
    semanticRefs.push({
        semanticRefIndex: refIndex,
        range: textRangeFromLocation(messageIndex, chunkIndex),
        knowledgeType: "topic",
        knowledge: topic,
    });
    semanticRefIndex.addTerm(topic.text, refIndex);
}

export function addActionToIndex(
    action: kpLib.Action,
    semanticRefs: SemanticRef[],
    semanticRefIndex: ITermToSemanticRefIndex,
    messageIndex: number,
    chunkIndex = 0,
) {
    const refIndex = semanticRefs.length;
    semanticRefs.push({
        semanticRefIndex: refIndex,
        range: textRangeFromLocation(messageIndex, chunkIndex),
        knowledgeType: "action",
        knowledge: action,
    });
    semanticRefIndex.addTerm(action.verbs.join(" "), refIndex);
    if (action.subjectEntityName !== "none") {
        semanticRefIndex.addTerm(action.subjectEntityName, refIndex);
    }
    if (action.objectEntityName !== "none") {
        semanticRefIndex.addTerm(action.objectEntityName, refIndex);
    }
    if (action.indirectObjectEntityName !== "none") {
        semanticRefIndex.addTerm(action.indirectObjectEntityName, refIndex);
    }
    if (action.params) {
        for (const param of action.params) {
            if (typeof param === "string") {
                semanticRefIndex.addTerm(param, refIndex);
            } else {
                semanticRefIndex.addTerm(param.name, refIndex);
                if (typeof param.value === "string") {
                    semanticRefIndex.addTerm(param.value, refIndex);
                }
            }
        }
    }
    addFacet(action.subjectEntityFacet, refIndex, semanticRefIndex);
}

export function addKnowledgeToIndex(
    semanticRefs: SemanticRef[],
    semanticRefIndex: ITermToSemanticRefIndex,
    messageIndex: MessageIndex,
    knowledge: kpLib.KnowledgeResponse,
): void {
    for (const entity of knowledge.entities) {
        addEntityToIndex(entity, semanticRefs, semanticRefIndex, messageIndex);
    }
    for (const action of knowledge.actions) {
        addActionToIndex(action, semanticRefs, semanticRefIndex, messageIndex);
    }
    for (const inverseAction of knowledge.inverseActions) {
        addActionToIndex(
            inverseAction,
            semanticRefs,
            semanticRefIndex,
            messageIndex,
        );
    }
    for (const topic of knowledge.topics) {
        const topicObj: Topic = { text: topic };
        addTopicToIndex(topicObj, semanticRefs, semanticRefIndex, messageIndex);
    }
}

export async function buildSemanticRefIndex<TMeta extends IKnowledgeSource>(
    conversation: IConversation<TMeta>,
    extractor?: kpLib.KnowledgeExtractor,
    eventHandler?: IndexingEventHandlers,
): Promise<IndexingResults> {
    conversation.semanticRefIndex ??= new ConversationIndex();
    const semanticRefIndex = conversation.semanticRefIndex;
    conversation.semanticRefIndex = semanticRefIndex;
    if (conversation.semanticRefs === undefined) {
        conversation.semanticRefs = [];
    }
    const semanticRefs = conversation.semanticRefs;
    extractor ??= createKnowledgeProcessor();
    const maxRetries = 4;
    let indexingResult: IndexingResults = {};
    for (let i = 0; i < conversation.messages.length; i++) {
        let messageIndex: MessageIndex = i;
        const chunkIndex = 0;
        const msg = conversation.messages[messageIndex];
        // only one chunk per message for now
        const text = msg.textChunks[chunkIndex];
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
                semanticRefs,
                semanticRefIndex,
                messageIndex,
                knowledge,
            );
        }
        const completedChunk = { messageIndex, chunkIndex };
        indexingResult.chunksIndexedUpto = completedChunk;
        if (
            eventHandler?.onKnowledgeExtracted &&
            !eventHandler.onKnowledgeExtracted(completedChunk, knowledge)
        ) {
            break;
        }
    }
    return indexingResult;
}

export function addToConversationIndex<TMeta extends IKnowledgeSource>(
    conversation: IConversation<TMeta>,
    messages: IMessage<TMeta>[],
    knowledgeResponses: kpLib.KnowledgeResponse[],
): void {
    if (conversation.semanticRefIndex === undefined) {
        conversation.semanticRefIndex = new ConversationIndex();
    }
    if (conversation.semanticRefs === undefined) {
        conversation.semanticRefs = [];
    }
    for (let i = 0; i < messages.length; i++) {
        const messageIndex: MessageIndex = conversation.messages.length;
        conversation.messages.push(messages[i]);
        const knowledge = knowledgeResponses[i];
        if (knowledge) {
            addKnowledgeToIndex(
                conversation.semanticRefs,
                conversation.semanticRefIndex,
                messageIndex,
                knowledge,
            );
        }
    }
}

/**
 * Notes:
 *  Case-insensitive
 */
export class ConversationIndex implements ITermToSemanticRefIndex {
    private map: Map<string, ScoredSemanticRef[]> = new Map();

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
        semanticRefIndex: SemanticRefIndex | ScoredSemanticRef,
    ): void {
        if (!term) {
            return;
        }
        if (typeof semanticRefIndex === "number") {
            semanticRefIndex = {
                semanticRefIndex: semanticRefIndex,
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

    lookupTerm(term: string): ScoredSemanticRef[] {
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
        for (const [term, semanticRefIndices] of this.map) {
            items.push({ term, semanticRefIndices });
        }
        return { items };
    }

    deserialize(data: ITermToSemanticRefIndexData): void {
        for (const termData of data.items) {
            if (termData && termData.term) {
                this.map.set(
                    this.prepareTerm(termData.term),
                    termData.semanticRefIndices,
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

export function createKnowledgeProcessor(
    chatModel?: ChatModel,
): kpLib.KnowledgeExtractor {
    chatModel ??= createKnowledgeModel();
    const extractor = kpLib.createKnowledgeExtractor(chatModel, {
        maxContextLength: 4096,
        mergeActionKnowledge: false,
    });
    return extractor;
}

export async function buildConversationIndex(
    conversation: IConversation,
    eventHandler?: IndexingEventHandlers,
): Promise<IndexingResults> {
    const result = await buildSemanticRefIndex(
        conversation,
        undefined,
        eventHandler,
    );
    if (!result.error && conversation.semanticRefIndex) {
        await buildSecondaryIndexes(conversation, true, eventHandler);
    }
    return result;
}
