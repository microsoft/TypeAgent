// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IConversation,
    IndexingResults,
    ISemanticRefCollection,
    ITermToSemanticRefIndex,
    ITermToSemanticRefIndexData,
    ITermToSemanticRefIndexItem,
    Knowledge,
    KnowledgeType,
    MessageOrdinal,
    ScoredSemanticRefOrdinal,
    SemanticRefOrdinal,
    Tag,
    TextIndexingResult,
    TextLocation,
    Topic,
} from "./interfaces.js";
import { IndexingEventHandlers } from "./interfaces.js";
import { conversation as kpLib } from "knowledge-processor";
import { openai } from "aiclient";
import { extractKnowledgeFromTextBatch } from "./knowledge.js";
import { facetValueToString } from "./knowledgeLib.js";
import { createKnowledgeExtractor } from "./knowledge.js";
import {
    addToSecondaryIndexes,
    buildSecondaryIndexes,
} from "./secondaryIndexes.js";
import { ConversationSettings } from "./conversation.js";
import { getMessageChunkBatch, textRangeFromMessageChunk } from "./message.js";
import { SemanticRefCollection } from "./storage.js";

function addTermToIndex(
    index: ITermToSemanticRefIndex,
    term: string,
    semanticRefOrdinal: SemanticRefOrdinal,
    termsAdded?: Set<string>,
) {
    term = index.addTerm(term, semanticRefOrdinal);
    if (termsAdded) {
        termsAdded.add(term);
    }
}

function addEntity(
    entity: kpLib.ConcreteEntity,
    semanticRefs: ISemanticRefCollection,
    semanticRefIndex: ITermToSemanticRefIndex,
    messageOrdinal: MessageOrdinal,
    chunkOrdinal: number,
    termsAdded?: Set<string>,
) {
    const semanticRefOrdinal = semanticRefs.length;
    semanticRefs.append({
        semanticRefOrdinal,
        range: textRangeFromMessageChunk(messageOrdinal, chunkOrdinal),
        knowledgeType: "entity",
        knowledge: entity,
    });
    addTermToIndex(
        semanticRefIndex,
        entity.name,
        semanticRefOrdinal,
        termsAdded,
    );
    // add each type as a separate term
    for (const type of entity.type) {
        addTermToIndex(semanticRefIndex, type, semanticRefOrdinal, termsAdded);
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
    termsAdded?: Set<string>,
) {
    if (facet !== undefined) {
        addTermToIndex(
            semanticRefIndex,
            facet.name,
            semanticRefOrdinal,
            termsAdded,
        );
        if (facet.value !== undefined) {
            addTermToIndex(
                semanticRefIndex,
                facetValueToString(facet),
                semanticRefOrdinal,
                termsAdded,
            );
        }
    }
}

function addTopic(
    topic: Topic,
    semanticRefs: ISemanticRefCollection,
    semanticRefIndex: ITermToSemanticRefIndex,
    messageOrdinal: MessageOrdinal,
    chunkOrdinal: number,
    termsAdded?: Set<string>,
) {
    const semanticRefOrdinal = semanticRefs.length;
    semanticRefs.append({
        semanticRefOrdinal,
        range: textRangeFromMessageChunk(messageOrdinal, chunkOrdinal),
        knowledgeType: "topic",
        knowledge: topic,
    });
    addTermToIndex(
        semanticRefIndex,
        topic.text,
        semanticRefOrdinal,
        termsAdded,
    );
}

function addAction(
    action: kpLib.Action,
    semanticRefs: ISemanticRefCollection,
    semanticRefIndex: ITermToSemanticRefIndex,
    messageOrdinal: MessageOrdinal,
    chunkOrdinal: number,
    termsAdded?: Set<string>,
) {
    const semanticRefOrdinal = semanticRefs.length;
    semanticRefs.append({
        semanticRefOrdinal,
        range: textRangeFromMessageChunk(messageOrdinal, chunkOrdinal),
        knowledgeType: "action",
        knowledge: action,
    });

    addTermToIndex(
        semanticRefIndex,
        action.verbs.join(" "),
        semanticRefOrdinal,
        termsAdded,
    );
    if (action.subjectEntityName !== "none") {
        addTermToIndex(
            semanticRefIndex,
            action.subjectEntityName,
            semanticRefOrdinal,
            termsAdded,
        );
    }
    if (action.objectEntityName !== "none") {
        addTermToIndex(
            semanticRefIndex,
            action.objectEntityName,
            semanticRefOrdinal,
            termsAdded,
        );
    }
    if (action.indirectObjectEntityName !== "none") {
        addTermToIndex(
            semanticRefIndex,
            action.indirectObjectEntityName,
            semanticRefOrdinal,
            termsAdded,
        );
    }
    if (action.params) {
        for (const param of action.params) {
            if (typeof param === "string") {
                addTermToIndex(
                    semanticRefIndex,
                    param,
                    semanticRefOrdinal,
                    termsAdded,
                );
            } else {
                addTermToIndex(
                    semanticRefIndex,
                    param.name,
                    semanticRefOrdinal,
                    termsAdded,
                );
                if (typeof param.value === "string") {
                    addTermToIndex(
                        semanticRefIndex,
                        param.value,
                        semanticRefOrdinal,
                        termsAdded,
                    );
                }
            }
        }
    }
    addFacet(
        action.subjectEntityFacet,
        semanticRefOrdinal,
        semanticRefIndex,
        termsAdded,
    );
}

function addTag(
    tag: Tag,
    semanticRefs: ISemanticRefCollection,
    semanticRefIndex: ITermToSemanticRefIndex,
    messageOrdinal: MessageOrdinal,
    chunkOrdinal: number,
    termsAdded?: Set<string>,
) {
    const semanticRefOrdinal = semanticRefs.length;
    semanticRefs.append({
        semanticRefOrdinal,
        range: textRangeFromMessageChunk(messageOrdinal, chunkOrdinal),
        knowledgeType: "tag",
        knowledge: tag,
    });
    addTermToIndex(semanticRefIndex, tag.text, semanticRefOrdinal, termsAdded);
}

export type KnowledgeValidator = (
    knowledgeType: KnowledgeType,
    knowledge: Knowledge,
) => boolean;

// TODO: update: pass in TextLocation instead of messageOrdinal + chunkOrdinal
export function addKnowledgeToSemanticRefIndex(
    conversation: IConversation,
    messageOrdinal: MessageOrdinal,
    chunkOrdinal: number,
    knowledge: kpLib.KnowledgeResponse,
    termsAdded?: Set<string>,
): void {
    verifyHasSemanticRefIndex(conversation);

    const semanticRefs = conversation.semanticRefs!;
    const semanticRefIndex = conversation.semanticRefIndex!;
    for (const entity of knowledge.entities) {
        if (validateEntity(entity)) {
            addEntity(
                entity,
                semanticRefs,
                semanticRefIndex,
                messageOrdinal,
                chunkOrdinal,
                termsAdded,
            );
        }
    }
    for (const action of knowledge.actions) {
        addAction(
            action,
            semanticRefs,
            semanticRefIndex,
            messageOrdinal,
            chunkOrdinal,
            termsAdded,
        );
    }
    for (const inverseAction of knowledge.inverseActions) {
        addAction(
            inverseAction,
            semanticRefs,
            semanticRefIndex,
            messageOrdinal,
            chunkOrdinal,
            termsAdded,
        );
    }
    for (const topic of knowledge.topics) {
        const topicObj: Topic = { text: topic };
        addTopic(
            topicObj,
            semanticRefs,
            semanticRefIndex,
            messageOrdinal,
            chunkOrdinal,
            termsAdded,
        );
    }
}

function validateEntity(entity: kpLib.ConcreteEntity): boolean {
    return entity.name !== undefined && entity.name.length > 0;
}

/**
 * Given a batch of text locations
 * - extract knowledge from them (in a batch)
 * - add the knowledge to the semantic ref index
 * @param conversation
 * @param batch
 * @param knowledgeExtractor
 * @param eventHandler
 * @param termsAdded
 * @returns
 */
async function addBatchToSemanticRefIndex(
    conversation: IConversation,
    batch: TextLocation[],
    knowledgeExtractor: kpLib.KnowledgeExtractor,
    eventHandler?: IndexingEventHandlers,
    termsAdded?: Set<string>,
): Promise<TextIndexingResult> {
    beginIndexing(conversation);

    const messages = conversation.messages;
    let indexingResult: TextIndexingResult = {};

    const textBatch = batch.map((tl) => {
        const text = messages.get(tl.messageOrdinal).textChunks[
            tl.chunkOrdinal ?? 0
        ];
        return text.trim();
    });
    const knowledgeResults = await extractKnowledgeFromTextBatch(
        knowledgeExtractor,
        textBatch,
        textBatch.length,
    );
    for (let i = 0; i < knowledgeResults.length; ++i) {
        const knowledgeResult = knowledgeResults[i];
        if (!knowledgeResult.success) {
            indexingResult.error = knowledgeResult.message;
            return indexingResult;
        }
        const textLocation = batch[i];
        const knowledge = knowledgeResult.data;
        addKnowledgeToSemanticRefIndex(
            conversation,
            textLocation.messageOrdinal,
            textLocation.chunkOrdinal ?? 0,
            knowledge,
            termsAdded,
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

function beginIndexing(conversation: IConversation) {
    if (conversation.semanticRefIndex === undefined) {
        conversation.semanticRefIndex = new ConversationIndex();
    }
    if (conversation.semanticRefs === undefined) {
        conversation.semanticRefs = new SemanticRefCollection();
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
 * TODO: Should rename this to TermToSemanticRefIndex
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
    ): string {
        if (!term) {
            return term;
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
        return term;
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

/**
 * Build a conversation index from scratch
 * @param conversation
 * @param settings
 * @param eventHandler
 * @returns
 */
export async function buildConversationIndex(
    conversation: IConversation,
    settings: ConversationSettings,
    eventHandler?: IndexingEventHandlers,
): Promise<IndexingResults> {
    const indexingResult: IndexingResults = {};

    addMessageKnowledgeToSemanticRefIndex(conversation, 0);

    if (settings.semanticRefIndexSettings.autoExtractKnowledge) {
        indexingResult.semanticRefs = await buildSemanticRefIndex(
            conversation,
            settings.semanticRefIndexSettings,
            eventHandler,
        );
    }
    if (!indexingResult.semanticRefs?.error && conversation.semanticRefIndex) {
        indexingResult.secondaryIndexResults = await buildSecondaryIndexes(
            conversation,
            settings,
            eventHandler,
        );
    }
    return indexingResult;
}

/**
 * Incrementally update the conversation index messages and semantic refs > than supplied ordinals
 * @param conversation
 * @param settings
 * @param messageOrdinalStartAt add messages starting at this ordinal
 * @param semanticRefOrdinalStartAt add semantic refs starting at this ordinal
 * @param eventHandler
 * @returns
 */
export async function addToConversationIndex(
    conversation: IConversation,
    settings: ConversationSettings,
    messageOrdinalStartAt: MessageOrdinal,
    semanticRefOrdinalStartAt: SemanticRefOrdinal,
    eventHandler?: IndexingEventHandlers,
): Promise<IndexingResults> {
    const indexingResult: IndexingResults = {};
    const termsAdded = new Set<string>();

    addMessageKnowledgeToSemanticRefIndex(
        conversation,
        messageOrdinalStartAt,
        undefined,
        termsAdded,
    );
    if (settings.semanticRefIndexSettings.autoExtractKnowledge) {
        indexingResult.semanticRefs = await addToSemanticRefIndex(
            conversation,
            settings.semanticRefIndexSettings,
            messageOrdinalStartAt,
            eventHandler,
            termsAdded,
        );
    }
    if (!indexingResult.semanticRefs?.error && conversation.semanticRefIndex) {
        let relatedTerms = [...termsAdded.values()];
        termsAdded.clear();
        indexingResult.secondaryIndexResults = await addToSecondaryIndexes(
            conversation,
            settings,
            messageOrdinalStartAt,
            semanticRefOrdinalStartAt,
            relatedTerms,
            eventHandler,
        );
    }
    return indexingResult;
}

export type SemanticRefIndexSettings = {
    batchSize: number;
    autoExtractKnowledge: boolean;
    knowledgeExtractor?: kpLib.KnowledgeExtractor;
};

/**
 * Build a complete semantic ref index from scratch for the given conversation
 * @param conversation
 * @param settings
 * @param eventHandler
 * @returns
 */
export async function buildSemanticRefIndex(
    conversation: IConversation,
    settings: SemanticRefIndexSettings,
    eventHandler?: IndexingEventHandlers,
): Promise<TextIndexingResult> {
    return addToSemanticRefIndex(conversation, settings, 0, eventHandler);
}

/**
 * Incrementally update the semanticRefIndex starting with message at messageOrdinalStartAt
 * @param conversation
 * @param settings
 * @param messageOrdinalStartAt
 * @param eventHandler
 * @returns
 */
export async function addToSemanticRefIndex(
    conversation: IConversation,
    settings: SemanticRefIndexSettings,
    messageOrdinalStartAt: MessageOrdinal,
    eventHandler?: IndexingEventHandlers,
    termsAdded?: Set<string>,
): Promise<TextIndexingResult> {
    beginIndexing(conversation);

    const knowledgeExtractor =
        settings.knowledgeExtractor ?? createKnowledgeExtractor();
    let indexingResult: TextIndexingResult | undefined;
    for (const textLocationBatch of getMessageChunkBatch(
        conversation.messages,
        messageOrdinalStartAt,
        settings.batchSize,
    )) {
        indexingResult = await addBatchToSemanticRefIndex(
            conversation,
            textLocationBatch,
            knowledgeExtractor,
            eventHandler,
            termsAdded,
        );
        if (indexingResult.error !== undefined) {
            break;
        }
    }
    return indexingResult ?? {};
}

/**
 * Messages are also sources of knowledge. This knowledge may be hardcoded
 * or extracted using other means
 * Add this knowledge to the index
 * @param conversation
 * @param messageOrdinalStartAt
 * @param knowledgeValidator
 * @returns
 */
export function addMessageKnowledgeToSemanticRefIndex(
    conversation: IConversation,
    messageOrdinalStartAt: MessageOrdinal,
    knowledgeValidator?: KnowledgeValidator,
    termsAdded?: Set<string>,
) {
    if (!conversation.semanticRefIndex) {
        return;
    }
    const messages = conversation.messages;
    const semanticRefs = conversation.semanticRefs;
    const semanticRefIndex = conversation.semanticRefIndex;
    for (
        let messageOrdinal = messageOrdinalStartAt;
        messageOrdinal < messages.length;
        messageOrdinal++
    ) {
        const msg = messages.get(messageOrdinal);
        const chunkOrdinal = 0;
        let knowledge = msg.getKnowledge();
        if (knowledge !== undefined) {
            addKnowledgeToSemanticRefIndex(
                conversation,
                messageOrdinal,
                chunkOrdinal,
                filterKnowledge(knowledge, knowledgeValidator),
                termsAdded,
            );
        }
        if (msg.tags && semanticRefs) {
            for (const tag of msg.tags) {
                const tagObj: Tag = { text: tag };
                addTag(
                    tagObj,
                    semanticRefs,
                    semanticRefIndex,
                    messageOrdinal,
                    chunkOrdinal,
                    termsAdded,
                );
            }
        }
    }
}

function filterKnowledge(
    knowledge: kpLib.KnowledgeResponse,
    knowledgeValidator?: KnowledgeValidator,
) {
    if (knowledgeValidator) {
        knowledge.entities = knowledge.entities.filter((entity) =>
            knowledgeValidator("entity", entity),
        );
        knowledge.actions = knowledge.actions.filter((action) =>
            knowledgeValidator("action", action),
        );
        knowledge.inverseActions = knowledge.inverseActions.filter((action) =>
            knowledgeValidator("action", action),
        );
        knowledge.topics = knowledge.topics.filter((topic) =>
            knowledgeValidator("topic", { text: topic }),
        );
    }
    return knowledge;
}
