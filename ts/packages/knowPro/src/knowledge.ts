// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversation as kpLib } from "knowledge-processor";
import { async, asyncArray } from "typeagent";
import { error, Result } from "typechat";
import { ChatModel } from "aiclient";
import { createKnowledgeModel } from "./conversationIndex.js";
import {
    concreteToMergedEntities,
    mergedToConcreteEntity,
} from "./knowledgeMerge.js";
import { BatchTask, runInBatches } from "./taskQueue.js";

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
        mergeEntityFacets: true,
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

export function createKnowledgeResponse(): kpLib.KnowledgeResponse {
    return {
        entities: [],
        actions: [],
        inverseActions: [],
        topics: [],
    };
}
