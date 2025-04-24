// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversation as kpLib } from "knowledge-processor";
import { async, asyncArray, getTopK } from "typeagent";
import {
    Knowledge,
    KnowledgeType,
    ScoredKnowledge,
    ScoredSemanticRefOrdinal,
    SemanticRef,
    Topic,
} from "./interfaces.js";
import { getScoredSemanticRefsFromOrdinals, Scored } from "./common.js";
import { error, Result } from "typechat";
import { BatchTask, runInBatches } from "./taskQueue.js";
import { ChatModel } from "aiclient";
import { createKnowledgeModel } from "./conversationIndex.js";
import {
    concreteToMergedEntities,
    mergedToConcreteEntity,
    mergeScoredConcreteEntities,
    MergedEntity,
} from "./knowledgeMerge.js";

/**
 * Contains a mix of public methods exposed via index.ts and internal only
 * TODO: Refactor into separate files
 */

//----------------
// PUBLIC FUNCTIONS
// Exposed directly via index.ts
//---------------

/**
 * Create a knowledge extractor using the given Chat Model
 * @param chatModel
 * @returns
 */
export function createKnowledgeExtractor(
    chatModel?: ChatModel,
): kpLib.KnowledgeExtractor {
    chatModel ??= createKnowledgeModel();
    const extractor = kpLib.createKnowledgeExtractor(chatModel, {
        maxContextLength: 4096,
        /**
         * This should *ALWAYS* be false.
         * Merging is handled during indexing:
         */
        mergeActionKnowledge: false,
    });
    return extractor;
}

export function extractKnowledgeFromText(
    knowledgeExtractor: kpLib.KnowledgeExtractor,
    text: string,
    maxRetries: number,
): Promise<Result<kpLib.KnowledgeResponse>> {
    return async.callWithRetry(() =>
        knowledgeExtractor.extractWithRetry(text, maxRetries),
    );
}

export function extractKnowledgeFromTextBatch(
    knowledgeExtractor: kpLib.KnowledgeExtractor,
    textBatch: string[],
    concurrency: number = 2,
    maxRetries: number = 3,
): Promise<Result<kpLib.KnowledgeResponse>[]> {
    return asyncArray.mapAsync(textBatch, concurrency, (text) =>
        extractKnowledgeFromText(knowledgeExtractor, text, maxRetries),
    );
}

export function mergeConcreteEntities(
    entities: kpLib.ConcreteEntity[],
): kpLib.ConcreteEntity[] {
    let mergedEntities = concreteToMergedEntities(entities);

    const mergedConcreteEntities: kpLib.ConcreteEntity[] = [];
    for (const mergedEntity of mergedEntities.values()) {
        mergedConcreteEntities.push(mergedToConcreteEntity(mergedEntity));
    }
    return mergedConcreteEntities;
}

export function mergeTopics(topics: string[]): string[] {
    let mergedTopics = new Set<string>();
    for (let topic of topics) {
        mergedTopics.add(topic);
    }
    return [...mergedTopics.values()];
}

//-----------------------
// INTERNAL FUNCTIONS
//-----------------------

export async function extractKnowledgeForTextBatchQ(
    knowledgeExtractor: kpLib.KnowledgeExtractor,
    textBatch: string[],
    concurrency: number = 2,
    maxRetries: number = 3,
): Promise<Result<kpLib.KnowledgeResponse>[]> {
    const taskBatch: BatchTask<string, kpLib.KnowledgeResponse>[] =
        textBatch.map((text) => {
            return {
                task: text,
            };
        });
    await runInBatches<string, kpLib.KnowledgeResponse>(
        taskBatch,
        (text: string) =>
            extractKnowledgeFromText(knowledgeExtractor, text, maxRetries),
        concurrency,
    );
    const results: Result<kpLib.KnowledgeResponse>[] = [];
    for (const task of taskBatch) {
        results.push(task.result ? task.result : error("No result"));
    }
    return results;
}

export function getDistinctSemanticRefTopics(
    semanticRefs: SemanticRef[],
    semanticRefMatches: ScoredSemanticRefOrdinal[],
    topK?: number,
): ScoredKnowledge[] {
    let mergedTopics = new Map<string, Scored<Topic>>();
    for (let semanticRefMatch of semanticRefMatches) {
        const semanticRef = semanticRefs[semanticRefMatch.semanticRefOrdinal];
        if (semanticRef.knowledgeType !== "topic") {
            continue;
        }
        const topic = semanticRef.knowledge as Topic;
        const existing = mergedTopics.get(topic.text);
        if (existing) {
            if (existing.score < semanticRefMatch.score) {
                existing.score = semanticRefMatch.score;
            }
        } else {
            mergedTopics.set(topic.text, {
                item: topic,
                score: semanticRefMatch.score,
            });
        }
    }
    const mergedKnowledge = getTopKnowledge<Topic>(
        mergedTopics.values(),
        "topic",
        (t) => t,
        topK,
    );
    return mergedKnowledge;
}

export function getDistinctSemanticRefEntities(
    semanticRefs: SemanticRef[],
    semanticRefMatches: ScoredSemanticRefOrdinal[],
    topK?: number,
): ScoredKnowledge[] {
    const scoredEntities = getScoredSemanticRefsFromOrdinals(
        semanticRefs,
        semanticRefMatches,
        "entity",
    );
    let mergedEntities = mergeScoredConcreteEntities(scoredEntities, false);
    const mergedKnowledge: ScoredKnowledge[] = getTopKnowledge<MergedEntity>(
        mergedEntities.values(),
        "entity",
        (m) => mergedToConcreteEntity(m),
        topK,
    );
    return mergedKnowledge;
}

function getTopKnowledge<T>(
    values: IterableIterator<Scored<T>>,
    type: KnowledgeType,
    toKnowledge: (item: T) => Knowledge,
    topK?: number,
) {
    let topKValues =
        topK !== undefined && topK > 0 ? getTopK(values, topK) : values;

    const mergedKnowledge: ScoredKnowledge[] = [];
    for (const scoredValue of topKValues) {
        mergedKnowledge.push({
            knowledgeType: type,
            knowledge: toKnowledge(scoredValue.item),
            score: scoredValue.score,
        });
    }
    return mergedKnowledge;
}
