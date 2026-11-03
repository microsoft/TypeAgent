// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import {
    currentTermNormalizationVersion,
    normalizeSearchTerm,
    type TermNormalizationVersion,
    validateTermNormalizationVersion,
} from "./termNormalization.js";

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
    StructuredTag,
    Tag,
    TextIndexingResult,
    TextLocation,
    Topic,
    PreparedIndexData,
    IPreparedIndexStorage,
} from "./interfaces.js";
import { IndexingEventHandlers } from "./interfaces.js";
import { conversation as kpLib } from "@typeagent/knowledge-processor";
import {
    openai,
    embeddingIdentityKey,
    validateEmbeddingVector,
} from "@typeagent/aiclient";
import { extractKnowledgeWithTemporalContext } from "./temporalKnowledge.js";
import { facetValueToString } from "./knowledgeLib.js";
import { createKnowledgeExtractor } from "./knowledge.js";
import {
    addToSecondaryIndexes,
    buildSecondaryIndexes,
} from "./secondaryIndexes.js";
import {
    ConversationSettings,
    prepareConversationEmbeddings,
} from "./conversation.js";
import { getMessageChunkBatch, textRangeFromMessageChunk } from "./message.js";
import { MessageCollection, SemanticRefCollection } from "./storage.js";
import { prepareInOrder } from "./preparedIndexing.js";
import {
    buildRelatedTermsIndex,
    RelatedTermsIndex,
    MessageTextIndex,
    addToTransientSecondaryIndexes,
    ConversationSecondaryIndexes,
    buildTransientSecondaryIndexes,
} from "./secondaryIndexes.js";

function addTermToIndex(
    index: ITermToSemanticRefIndex,
    term: string,
    semanticRefOrdinal: SemanticRefOrdinal,
    termsAdded?: Set<string>,
) {
    if (!term.trim()) {
        console.warn(
            "knowPro: skipping an empty extracted semantic term during indexing",
        );
        return;
    }
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
    addEntitySemanticRefToIndex(
        entity,
        semanticRefIndex,
        semanticRefOrdinal,
        termsAdded,
    );
}

function addEntitySemanticRefToIndex(
    entity: kpLib.ConcreteEntity,
    semanticRefIndex: ITermToSemanticRefIndex,
    semanticRefOrdinal: number,
    termsAdded?: Set<string>,
) {
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

function addStructuredTag(
    sTag: StructuredTag,
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
        knowledgeType: "sTag",
        knowledge: sTag,
    });
    addEntitySemanticRefToIndex(
        sTag,
        semanticRefIndex,
        semanticRefOrdinal,
        termsAdded,
    );
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
    knowledgeValidator?: KnowledgeValidator,
    eventHandler?: IndexingEventHandlers,
    termsAdded?: Set<string>,
): Promise<TextIndexingResult> {
    beginIndexing(conversation);

    const messages = conversation.messages;
    const indexingResult: TextIndexingResult = {};

    const knowledgeResults = await extractKnowledgeWithTemporalContext(
        messages,
        batch,
        knowledgeExtractor,
    );
    for (let i = 0; i < knowledgeResults.length; ++i) {
        const knowledgeResult = knowledgeResults[i];
        if (!knowledgeResult.success) {
            indexingResult.error = knowledgeResult.message;
            return indexingResult;
        }
        const textLocation = batch[i];
        const knowledge = filterKnowledge(
            knowledgeResult.data,
            knowledgeValidator,
        );
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
        conversation.semanticRefIndex = new TermToSemanticRefIndex();
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
 * Case-insensitive term-to-semantic-ref index.
 */
export class TermToSemanticRefIndex implements ITermToSemanticRefIndex {
    private map: Map<string, ScoredSemanticRefOrdinal[]> = new Map();
    public normalizationVersion: TermNormalizationVersion;

    constructor(data?: ITermToSemanticRefIndexData | undefined) {
        this.normalizationVersion = validateTermNormalizationVersion(
            data
                ? (data.normalizationVersion ?? 1)
                : currentTermNormalizationVersion,
        );
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
        if (!term) {
            console.warn(
                "knowPro: extracted search term normalizes to empty; term was not indexed",
            );
            return term;
        }
        const existing = this.map.get(term);
        if (existing != undefined) {
            const duplicate =
                this.normalizationVersion === 2
                    ? existing.find(
                          (posting) =>
                              posting.semanticRefOrdinal ===
                              semanticRefIndex.semanticRefOrdinal,
                      )
                    : undefined;
            if (duplicate)
                duplicate.score = Math.max(
                    duplicate.score,
                    semanticRefIndex.score,
                );
            else existing.push(semanticRefIndex);
        } else {
            this.map.set(term, [semanticRefIndex]);
        }
        return term;
    }

    lookupTerm(term: string): ScoredSemanticRefOrdinal[] {
        return this.map.get(this.prepareTerm(term)) ?? [];
    }

    removeTerm(term: string, semanticRefIndex: number): void {
        const key = this.prepareTerm(term);
        const postings = this.map
            .get(key)
            ?.filter(
                (posting) => posting.semanticRefOrdinal !== semanticRefIndex,
            );
        if (postings?.length) this.map.set(key, postings);
        else this.map.delete(key);
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
        return { items, normalizationVersion: this.normalizationVersion };
    }

    deserialize(data: ITermToSemanticRefIndexData): void {
        this.normalizationVersion = validateTermNormalizationVersion(
            data.normalizationVersion ?? 1,
        );
        this.map.clear();
        for (const termData of data.items) {
            if (termData && termData.term) {
                for (const posting of termData.semanticRefOrdinals)
                    this.addTerm(termData.term, { ...posting });
            }
        }
    }

    /**
     * Do any pre-processing of the term.
     * @param term
     */
    private prepareTerm(term: string): string {
        return normalizeSearchTerm(term, this.normalizationVersion);
    }
}

export function createKnowledgeModel() {
    const chatModelSettings = openai.apiSettingsFromEnv(
        openai.ModelType.Chat,
        undefined,
        "GPT_6_LUNA",
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
    if (settings.preparedIndexing) {
        beginIndexing(conversation);
        return addPreparedConversationIndex(
            conversation,
            settings,
            0,
            eventHandler,
            true,
        );
    }
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
    if (settings.preparedIndexing) {
        beginIndexing(conversation);
        return addPreparedConversationIndex(
            conversation,
            settings,
            messageOrdinalStartAt,
            eventHandler,
        );
    }
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
        const relatedTerms = [...termsAdded.values()];
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

async function addPreparedConversationIndex(
    conversation: IConversation,
    settings: ConversationSettings,
    start: number,
    eventHandler?: IndexingEventHandlers,
    rebuild = false,
): Promise<IndexingResults> {
    const limits = settings.preparedIndexing!;
    if (conversation.semanticRefs!.isPersistent)
        return addPersistentPreparedConversationIndex(
            conversation,
            settings,
            start,
            rebuild,
            eventHandler,
        );
    const baseRef = conversation.semanticRefs!.length;
    addMessageKnowledgeToSemanticRefIndex(conversation, start);
    const extractor = settings.semanticRefIndexSettings.autoExtractKnowledge
        ? (settings.semanticRefIndexSettings.knowledgeExtractor ??
          createKnowledgeExtractor())
        : undefined;
    const predecessors = new Map<string, Promise<void>>();
    const count = conversation.messages.length - start;
    const prepare = async (sequence: number, signal: AbortSignal) => {
        const ordinal = start + sequence;
        const message = conversation.messages.get(ordinal);
        const temporal = message.metadata?.temporalContext;
        const key =
            temporal &&
            JSON.stringify([temporal.sourceRevisionId, temporal.ownerId]);
        const prerequisite = key ? predecessors.get(key) : undefined;
        let release: (() => void) | undefined;
        if (key)
            predecessors.set(
                key,
                new Promise<void>((resolve) => {
                    release = resolve;
                }),
            );
        try {
            await prerequisite;
            signal.throwIfAborted();
            const locations: TextLocation[] = message.textChunks.map(
                (_, chunkOrdinal) => ({
                    messageOrdinal: ordinal,
                    chunkOrdinal,
                }),
            );
            const results = extractor
                ? await extractKnowledgeWithTemporalContext(
                      conversation.messages,
                      locations,
                      extractor,
                  )
                : [];
            const knowledge = results.map((result) => {
                if (!result.success) throw new Error(result.message);
                return filterKnowledge(
                    result.data,
                    settings.semanticRefIndexSettings.knowledgeValidator,
                );
            });
            signal.throwIfAborted();
            const local: IConversation = {
                nameTag: conversation.nameTag,
                tags: [],
                messages: new MessageCollection([message]),
                semanticRefs: new SemanticRefCollection(),
                semanticRefIndex: new TermToSemanticRefIndex({
                    normalizationVersion:
                        conversation.semanticRefIndex?.normalizationVersion ??
                        1,
                    items: [],
                }),
                secondaryIndexes: {},
            };
            addMessageKnowledgeToSemanticRefIndex(local, 0);
            knowledge.forEach((value, chunk) =>
                addKnowledgeToSemanticRefIndex(local, 0, chunk, value),
            );
            const related = new RelatedTermsIndex({
                ...settings.relatedTermIndexSettings,
                normalizationVersion:
                    conversation.semanticRefIndex?.normalizationVersion ?? 1,
            });
            local.secondaryIndexes!.termToRelatedTermsIndex = related;
            const relatedResult = await buildRelatedTermsIndex(
                local,
                related.settings,
            );
            if (relatedResult.error) throw new Error(relatedResult.error);
            const messages = new MessageTextIndex(
                settings.messageTextIndexSettings,
            );
            if (messages.isEmbeddingEnabled) {
                const result = await messages.addMessages([message]);
                if (result.error) throw new Error(result.error);
            }
            signal.throwIfAborted();
            return {
                knowledge,
                terms: local.semanticRefIndex!.getTerms(),
                related: related.serialize(),
                messages: messages.serialize(),
            };
        } finally {
            release?.();
        }
    };
    let completedUpto: TextLocation | undefined;
    await prepareInOrder(count, limits, prepare, (unit, sequence) => {
        const ordinal = start + sequence;
        unit.knowledge.forEach((knowledge, chunkOrdinal) => {
            addKnowledgeToSemanticRefIndex(
                conversation,
                ordinal,
                chunkOrdinal,
                knowledge,
            );
            completedUpto = { messageOrdinal: ordinal, chunkOrdinal };
            if (
                eventHandler?.onKnowledgeExtracted?.(
                    completedUpto,
                    knowledge,
                ) === false
            )
                throw new Error(
                    "Prepared indexing cancelled by knowledge handler",
                );
        });
        const related = conversation.secondaryIndexes?.termToRelatedTermsIndex;
        if (!(related instanceof RelatedTermsIndex))
            throw new Error(
                "Prepared indexing requires the KnowPro related-term index",
            );
        related.addPreparedData(unit.related, unit.terms);
        const messages = conversation.secondaryIndexes?.messageIndex;
        if (messages !== undefined) {
            if (!(messages instanceof MessageTextIndex))
                throw new Error(
                    "Prepared indexing requires the KnowPro message index",
                );
            messages.addPreparedData(unit.messages, ordinal);
        }
    });
    const related = conversation.secondaryIndexes?.termToRelatedTermsIndex;
    if (related instanceof RelatedTermsIndex)
        related.orderPreparedTerms(conversation.semanticRefIndex!.getTerms());
    const transient = addToTransientSecondaryIndexes(
        conversation,
        settings,
        start,
        baseRef,
    );
    return {
        semanticRefs: { completedUpto },
        secondaryIndexResults: {
            ...transient,
            relatedTerms: { numberCompleted: count },
            message: { numberCompleted: count },
        },
    };
}

function persistentPreparedStorage(
    conversation: IConversation,
): IPreparedIndexStorage {
    const provider = conversation.storageProvider;
    if (!provider?.createPreparedIndexStorage)
        throw new Error(
            "Persistent prepared indexing requires a prepared transaction capability",
        );
    return provider.createPreparedIndexStorage(
        conversation.messages,
        conversation.semanticRefs!,
    );
}

function preparedCandidate(
    conversation: IConversation,
    settings: ConversationSettings,
    data?: PreparedIndexData,
): IConversation {
    const secondary = new ConversationSecondaryIndexes(settings);
    if (data) {
        secondary.termToRelatedTermsIndex.deserialize(
            data.relatedTermsIndexData,
        );
        if (data.messageIndexData)
            secondary.messageIndex?.deserialize(data.messageIndexData);
    } else if (
        conversation.secondaryIndexes?.termToRelatedTermsIndex instanceof
        RelatedTermsIndex
    ) {
        secondary.termToRelatedTermsIndex.aliases.deserialize(
            conversation.secondaryIndexes.termToRelatedTermsIndex.aliases.serialize(),
        );
    }
    return {
        nameTag: conversation.nameTag,
        tags: [...conversation.tags],
        messages: new MessageCollection(conversation.messages.getAll()),
        semanticRefs: new SemanticRefCollection(
            data ? conversation.semanticRefs!.getAll() : [],
        ),
        semanticRefIndex: new TermToSemanticRefIndex(data?.semanticIndexData),
        secondaryIndexes: secondary,
    };
}

function validatePreparedEmbeddings(
    data: PreparedIndexData,
    identities: PreparedIndexData["embeddingIdentities"],
    settings: ConversationSettings,
): void {
    if (
        Object.keys(data.embeddingIdentities).length !==
            Object.keys(identities).length ||
        Object.entries(identities).some(
            ([lane, identity]) =>
                !data.embeddingIdentities[lane] ||
                embeddingIdentityKey(identity) !==
                    embeddingIdentityKey(data.embeddingIdentities[lane]),
        )
    )
        throw new Error(
            "Prepared embedding identity changed; rebuild the index",
        );
    for (const [vectors, dimensions] of [
        [
            data.relatedTermsIndexData.textEmbeddingData?.embeddings ?? [],
            settings.relatedTermIndexSettings.embeddingIndexSettings
                ?.embeddingSize,
        ],
        [
            data.messageIndexData?.indexData?.embeddings ?? [],
            settings.messageTextIndexSettings.embeddingIndexSettings
                .embeddingSize,
        ],
    ] as const) {
        if (
            vectors.length &&
            (!Object.keys(identities).length || dimensions === undefined)
        )
            throw new Error(
                "Prepared vectors require a known embedding identity",
            );
        for (const vector of vectors)
            validateEmbeddingVector(Array.from(vector), dimensions!);
    }
}

export async function restorePreparedConversationIndex(
    conversation: IConversation,
    settings: ConversationSettings,
): Promise<number | undefined> {
    const storage = persistentPreparedStorage(conversation);
    const snapshot = storage.capture();
    if (!snapshot.data) return undefined;
    const identities = await prepareConversationEmbeddings(settings);
    validatePreparedEmbeddings(snapshot.data, identities, settings);
    const candidate = preparedCandidate(conversation, settings, snapshot.data);
    buildTransientSecondaryIndexes(candidate, settings);
    if (storage.capture(false).stamp !== snapshot.stamp)
        throw new Error("Prepared index snapshot changed during restore");
    conversation.semanticRefIndex = candidate.semanticRefIndex;
    conversation.secondaryIndexes = candidate.secondaryIndexes;
    return snapshot.data.indexedMessageCount;
}

async function addPersistentPreparedConversationIndex(
    conversation: IConversation,
    settings: ConversationSettings,
    start: number,
    rebuild: boolean,
    eventHandler?: IndexingEventHandlers,
): Promise<IndexingResults> {
    const storage = persistentPreparedStorage(conversation);
    const snapshot = storage.capture(!rebuild);
    if (
        !rebuild &&
        (start > (snapshot.data?.indexedMessageCount ?? 0) ||
            (!snapshot.data && conversation.semanticRefs!.length))
    )
        throw new Error(
            "Rebuild the persistent index before resuming prepared ingestion",
        );
    const identities = await prepareConversationEmbeddings(settings);
    if (
        Object.keys(identities).length === 0 &&
        [
            settings.relatedTermIndexSettings.embeddingIndexSettings,
            settings.messageTextIndexSettings.embeddingIndexSettings,
            settings.threadSettings,
        ].some((lane) => lane?.embeddingModel !== undefined)
    )
        throw new Error(
            "Persistent preparation requires known embedding identities",
        );
    if (snapshot.data)
        validatePreparedEmbeddings(snapshot.data, identities, settings);
    const candidate = preparedCandidate(conversation, settings, snapshot.data);
    if (snapshot.data) buildTransientSecondaryIndexes(candidate, settings);
    const result = await addPreparedConversationIndex(
        candidate,
        settings,
        snapshot.data?.indexedMessageCount ?? 0,
        eventHandler,
    );
    const secondary =
        candidate.secondaryIndexes as ConversationSecondaryIndexes;
    const data: PreparedIndexData = {
        indexedMessageCount: candidate.messages.length,
        semanticIndexData: (
            candidate.semanticRefIndex as TermToSemanticRefIndex
        ).serialize(),
        relatedTermsIndexData: secondary.termToRelatedTermsIndex.serialize(),
        messageIndexData: secondary.messageIndex?.serialize(),
        embeddingIdentities: identities,
    };
    validatePreparedEmbeddings(data, identities, settings);
    settings.preparedIndexing!.signal?.throwIfAborted();
    storage.commit(snapshot.stamp, {
        messages: candidate.messages.getAll(),
        semanticRefs: candidate.semanticRefs!.getAll(),
        data,
    });
    conversation.semanticRefIndex = candidate.semanticRefIndex;
    conversation.secondaryIndexes = candidate.secondaryIndexes;
    return result;
}

export type SemanticRefIndexSettings = {
    batchSize: number;
    autoExtractKnowledge: boolean;
    knowledgeExtractor?: kpLib.KnowledgeExtractor;
    knowledgeValidator?: KnowledgeValidator;
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
            settings.knowledgeValidator,
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
        const knowledge = msg.getKnowledge();
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
                if (typeof tag === "string") {
                    const tagObj: Tag = { text: tag };
                    addTag(
                        tagObj,
                        semanticRefs,
                        semanticRefIndex,
                        messageOrdinal,
                        chunkOrdinal,
                        termsAdded,
                    );
                } else {
                    addStructuredTag(
                        tag,
                        semanticRefs,
                        semanticRefIndex,
                        messageOrdinal,
                        chunkOrdinal,
                        termsAdded,
                    );
                }
            }
        }
        /*
        if (msg.sTags && semanticRefs) {
            for (const sTag of msg.sTags) {
                addStructuredTag(
                    sTag,
                    semanticRefs,
                    semanticRefIndex,
                    messageOrdinal,
                    chunkOrdinal,
                    termsAdded,
                );
            }
        }
            */
    }
}

export function filterKnowledge(
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
