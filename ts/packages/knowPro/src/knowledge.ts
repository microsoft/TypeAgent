// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversation as kpLib } from "knowledge-processor";
import { async, asyncArray, loadSchema } from "typeagent";
import {
    createJsonTranslator,
    error,
    PromptSection,
    Result,
    success,
    TypeChatJsonTranslator,
    TypeChatLanguageModel,
} from "typechat";
import { ChatModel } from "aiclient";
import { createKnowledgeModel } from "./conversationIndex.js";
import { BatchTask, runInBatches } from "./taskQueue.js";
import { Tag } from "./interfaces.js";
import { createTypeScriptJsonValidator } from "typechat/ts";
import * as knowledgeSchema2 from "./knowledgeSchema_v2.js";

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

export function mergeTopics(topics: string[]): string[] {
    let mergedTopics = new Set<string>();
    for (let topic of topics) {
        mergedTopics.add(topic);
    }
    return [...mergedTopics.values()];
}

export function mergeTags(tags: Tag[]): string[] {
    let mergedText = new Set<string>();
    for (let tag of tags) {
        mergedText.add(tag.text);
    }
    return [...mergedText.values()];
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

export function createKnowledgeTranslator2(
    model: TypeChatLanguageModel,
): TypeChatJsonTranslator<kpLib.KnowledgeResponse> {
    const translator = kpLib.createKnowledgeTranslator(model);
    const translator2 = createTranslator2(model);
    translator.createRequestPrompt = translator2.createRequestPrompt;
    translator.translate = translate;
    return translator;

    async function translate(
        request: string,
        promptPreamble?: string | PromptSection[],
    ): Promise<Result<kpLib.KnowledgeResponse>> {
        const result = await translator2.translate(request, promptPreamble);
        if (!result.success) {
            return result;
        }
        const knowledge = knowledgeResponseFromV2(result.data);
        return success(knowledge);
    }
}

function createTranslator2(
    model: TypeChatLanguageModel,
): TypeChatJsonTranslator<knowledgeSchema2.KnowledgeResponse> {
    const schema = loadSchema(["knowledgeSchema_v2.ts"], import.meta.url);
    const typeName = "KnowledgeResponse";
    const validator =
        createTypeScriptJsonValidator<knowledgeSchema2.KnowledgeResponse>(
            schema,
            typeName,
        );
    const translator = createJsonTranslator<knowledgeSchema2.KnowledgeResponse>(
        model,
        validator,
    );
    translator.createRequestPrompt = createRequestPrompt;
    return translator;

    function createRequestPrompt(request: string) {
        return (
            `You are a service that translates user messages in a conversation into JSON objects of type "${typeName}" according to the following TypeScript definitions:\n` +
            `\`\`\`\n${schema}\`\`\`\n` +
            `The following are messages in a conversation:\n` +
            `"""\n${request}\n"""\n` +
            `The following is the user request translated into a JSON object with no spaces of indentation and no properties with the value undefined:\n`
        );
    }
}

function knowledgeResponseFromV2(
    response2: knowledgeSchema2.KnowledgeResponse,
): kpLib.KnowledgeResponse {
    const response: kpLib.KnowledgeResponse = {
        entities: response2.entities,
        topics: response2.topics,
        actions: response2.actions.map((a) => actionFromAction2(a)),
        inverseActions: [],
    };
    for (const action2 of response2.actions) {
        const action = inverseActionFromAction2(action2);
        if (action !== undefined) {
            response.inverseActions.push(action);
        }
    }
    return response;
}

function actionFromAction2(action2: knowledgeSchema2.Action): kpLib.Action {
    const action: kpLib.Action = {
        verbs: action2.inverseVerbs,
        verbTense: action2.verbTense,
        subjectEntityName: action2.subjectEntityName,
        objectEntityName: action2.objectEntityName,
        indirectObjectEntityName: action2.indirectObjectEntityName,
        subjectEntityFacet: action2.subjectEntityFacet,
    };
    if (action2.params) {
        action.params = action2.params;
    }
    return action;
}

function inverseActionFromAction2(
    action2: knowledgeSchema2.Action,
): kpLib.Action | undefined {
    if (
        action2.inverseVerbs === undefined ||
        action2.inverseVerbs.length === 0
    ) {
        return undefined;
    }

    let subjectEntityName: string | undefined;
    let objectEntityName = kpLib.NoEntityName;
    let indirectObjectEntityName = kpLib.NoEntityName;
    if (action2.objectEntityName !== undefined) {
        subjectEntityName = action2.objectEntityName;
        objectEntityName = action2.subjectEntityName;
    } else if (action2.indirectObjectEntityName !== undefined) {
        subjectEntityName = action2.indirectObjectEntityName;
        indirectObjectEntityName = action2.subjectEntityName;
    }
    if (
        subjectEntityName === undefined ||
        subjectEntityName === kpLib.NoEntityName
    ) {
        return undefined;
    }
    const action: kpLib.Action = {
        verbs: action2.inverseVerbs,
        verbTense: action2.verbTense,
        subjectEntityName,
        objectEntityName,
        indirectObjectEntityName,
        subjectEntityFacet: action2.subjectEntityFacet,
    };
    if (action2.params) {
        action.params = action2.params;
    }
    return action;
}
