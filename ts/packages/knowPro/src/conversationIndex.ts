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
    SemanticRefIndex,
    MessageIndex,
} from "./dataFormat.js";
import { conversation } from "knowledge-processor";
import { openai } from "aiclient";
import { Result } from "typechat";
import { async } from "typeagent";

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

function textLocationFromLocation(
    messageIndex: MessageIndex,
    chunkIndex = 0,
): TextLocation {
    return { messageIndex, chunkIndex };
}

export function textRangeFromLocation(
    messageIndex: MessageIndex,
    chunkIndex = 0,
): TextRange {
    return {
        start: textLocationFromLocation(messageIndex, chunkIndex),
        end: undefined,
    };
}

function addFacet(
    facet: conversation.Facet | undefined,
    refIndex: number,
    semanticRefIndex: ITermToSemanticRefIndex,
) {
    if (facet !== undefined) {
        semanticRefIndex.addTerm(facet.name, refIndex);
        if (facet.value !== undefined) {
            semanticRefIndex.addTerm(
                conversation.knowledgeValueToString(facet.value),
                refIndex,
            );
        }
    }
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

export function addKnowledgeToIndex(
    semanticRefs: SemanticRef[],
    semanticRefIndex: ITermToSemanticRefIndex,
    messageIndex: MessageIndex,
    knowledge: conversation.KnowledgeResponse,
) {
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
        const topicObj: ITopic = { text: topic };
        addTopicToIndex(topicObj, semanticRefs, semanticRefIndex, messageIndex);
    }
}

export type ConversationIndexingResult = {
    index: ConversationIndex;
    failedMessages: { message: IMessage; error: string }[];
};

export async function buildConversationIndex<TMeta extends IKnowledgeSource>(
    convo: IConversation<TMeta>,
    progressCallback?: (
        text: string,
        knowledgeResult: Result<conversation.KnowledgeResponse>,
    ) => boolean,
): Promise<ConversationIndexingResult> {
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
    let indexingResult: ConversationIndexingResult = {
        index: semanticRefIndex,
        failedMessages: [],
    };
    for (let i = 0; i < convo.messages.length; i++) {
        const msg = convo.messages[i];
        // only one chunk per message for now
        const text = msg.textChunks[0];
        try {
            const knowledgeResult = await async.callWithRetry(() =>
                extractor.extractWithRetry(text, maxRetries),
            );
            if (progressCallback && !progressCallback(text, knowledgeResult)) {
                break;
            }
            if (knowledgeResult.success) {
                const knowledge = knowledgeResult.data;
                if (knowledge) {
                    addKnowledgeToIndex(
                        semanticRefs,
                        semanticRefIndex,
                        i,
                        knowledge,
                    );
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
        if (typeof semanticRefIndex === "number") {
            semanticRefIndex = {
                semanticRefIndex: semanticRefIndex,
                score: 1,
            };
        }
        term = this.prepareTerm(term);
        if (this.map.has(term)) {
            this.map.get(term)?.push(semanticRefIndex);
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
