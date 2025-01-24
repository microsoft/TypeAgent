// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ITermToSemanticRefIndex,
    ITermToSemanticRefIndexData,
    ITermToSemanticRefIndexItem,
    ScoredSemanticRef,
    IConversation,
    IKnowledgeSource,
    SemanticRef,
    ITopic,
    TextRange,
    TextLocation,
    IMessage,
} from "./dataFormat.js";
import { conversation } from "knowledge-processor";
import { openai } from "aiclient";
import { callWithRetry } from "../../typeagent/dist/async.js";
import { Result } from "typechat";

function addFacet(
    facet: conversation.Facet | undefined,
    refIndex: number,
    semanticRefIndex: ITermToSemanticRefIndex,
) {
    if (facet !== undefined) {
        semanticRefIndex.addTerm(facet.name, refIndex);
        if (facet.value !== undefined && typeof facet.value === "string") {
            semanticRefIndex.addTerm(facet.value, refIndex);
        }
    }
}

function textLocationFromLocation(
    messageIndex: number,
    chunkIndex = 0,
): TextLocation {
    return { messageIndex, chunkIndex };
}

function textRangeFromLocation(
    messageIndex: number,
    chunkIndex = 0,
): TextRange {
    return {
        start: textLocationFromLocation(messageIndex, chunkIndex),
        end: undefined,
    };
}

function createKnowledgeModel() {
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

export function addEntityToIndex(
    entity: conversation.ConcreteEntity,
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

export function addTopicToIndex(
    topic: ITopic,
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
    action: conversation.Action,
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

export type IndexingResult = {
    index: ConversationIndex;
    failedMessages: { message: IMessage; error: string }[];
};

export async function buildConversationIndex<TMeta extends IKnowledgeSource>(
    convo: IConversation<TMeta>,
    progressCallback?: (
        text: string,
        knowledgeResult: Result<conversation.KnowledgeResponse>,
    ) => boolean,
): Promise<IndexingResult> {
    const semanticRefIndex = new ConversationIndex();
    convo.semanticRefIndex = semanticRefIndex;
    if (convo.semanticRefs === undefined) {
        convo.semanticRefs = [];
    }
    const semanticRefs = convo.semanticRefs;
    const chatModel = createKnowledgeModel();
    const extractor = conversation.createKnowledgeExtractor(chatModel, {
        maxContextLength: 4096,
        mergeActionKnowledge: false,
    });
    const maxRetries = 4;
    let indexingResult: IndexingResult = {
        index: semanticRefIndex,
        failedMessages: [],
    };
    for (let i = 0; i < convo.messages.length; i++) {
        const msg = convo.messages[i];
        // only one chunk per message for now
        const text = msg.textChunks[0];
        try {
            const knowledgeResult = await callWithRetry(() =>
                extractor.extractWithRetry(text, maxRetries),
            );
            if (progressCallback && !progressCallback(text, knowledgeResult)) {
                break;
            }
            if (knowledgeResult.success) {
                const knowledge = knowledgeResult.data;
                if (knowledge) {
                    for (const entity of knowledge.entities) {
                        addEntityToIndex(
                            entity,
                            semanticRefs,
                            semanticRefIndex,
                            i,
                        );
                    }
                    for (const action of knowledge.actions) {
                        addActionToIndex(
                            action,
                            semanticRefs,
                            semanticRefIndex,
                            i,
                        );
                    }
                    for (const inverseAction of knowledge.inverseActions) {
                        addActionToIndex(
                            inverseAction,
                            semanticRefs,
                            semanticRefIndex,
                            i,
                        );
                    }
                    for (const topic of knowledge.topics) {
                        const topicObj: ITopic = { text: topic };
                        addTopicToIndex(
                            topicObj,
                            semanticRefs,
                            semanticRefIndex,
                            i,
                        );
                    }
                }
            } else {
                indexingResult.failedMessages.push({
                    message: msg,
                    error: knowledgeResult.message,
                });
            }
        } catch (ex) {
            indexingResult.failedMessages.push({
                message: msg,
                error: `${ex}`,
            });
        }
    }
    return indexingResult;
}

/**
 * Notes:
 *  Case-insensitive
 */
export class ConversationIndex implements ITermToSemanticRefIndex {
    map: Map<string, ScoredSemanticRef[]> = new Map<
        string,
        ScoredSemanticRef[]
    >();

    constructor(data?: ITermToSemanticRefIndexData | undefined) {
        if (data) {
            this.deserialize(data);
        }
    }

    addTerm(term: string, semanticRefResult: number | ScoredSemanticRef): void {
        if (typeof semanticRefResult === "number") {
            semanticRefResult = {
                semanticRefIndex: semanticRefResult,
                score: 1,
            };
        }
        term = this.prepareTerm(term);
        if (this.map.has(term)) {
            this.map.get(term)?.push(semanticRefResult);
        } else {
            this.map.set(term, [semanticRefResult]);
        }
    }

    lookupTerm(term: string, fuzzy = false): ScoredSemanticRef[] {
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
