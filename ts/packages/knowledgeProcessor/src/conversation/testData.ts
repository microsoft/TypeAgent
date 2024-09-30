import path from "path";
import { AnswerResponse } from "./answerSchema.js";
import {
    asyncArray,
    getFileName,
    readAllLines,
    readJsonFile,
    stringSimilarity,
    writeJsonFile,
} from "typeagent";
import { ConversationManager } from "./conversationManager.js";
import { TextEmbeddingModel } from "aiclient";

export type QueryAnswer = {
    query: string;
    answer?: AnswerResponse | undefined;
};

export type BatchProgress = (
    item: string,
    index: number,
    total: number,
    result: QueryAnswer,
) => void | boolean;

export async function searchBatchFile(
    cm: ConversationManager,
    filePath: string,
    destPath: string | undefined,
    concurrency: number,
    progress?: BatchProgress,
): Promise<void> {
    if (!destPath) {
        destPath = path.join(
            path.dirname(filePath),
            `${getFileName(filePath)}_result.json`,
        );
    }
    let lines = await readAllLines(filePath, undefined, true, true);
    let results = await searchBatch(cm, lines, concurrency, progress);
    await writeJsonFile(destPath, results);
}

export async function searchBatch(
    cm: ConversationManager,
    queries: string[],
    concurrency: number,
    progress?: BatchProgress,
): Promise<QueryAnswer[]> {
    let results = await asyncArray.mapAsync(
        queries,
        concurrency,
        async (query, index) => {
            const rr = await cm.search(query);
            return { query, answer: rr?.response?.answer };
        },
        progress
            ? (item, index, answer) =>
                  progress(item, index, queries.length, answer)
            : undefined,
    );
    return results;
}

export type QueryAnswerCompare = {
    baseLine: QueryAnswer;
    answer?: AnswerResponse | undefined;
    similarity: number;
};

export async function compareQueryBatch(
    cm: ConversationManager,
    model: TextEmbeddingModel,
    filePath: string,
    concurrency: number,
    progress?: BatchProgress,
): Promise<QueryAnswerCompare[]> {
    const baseLine = await readJsonFile<QueryAnswer[]>(filePath);
    if (!baseLine || baseLine.length === 0) {
        return [];
    }
    const queries = baseLine.map((qa) => qa.query);
    const results = await searchBatch(cm, queries, concurrency, progress);
    const comparisons: QueryAnswerCompare[] = [];
    for (let i = 0; i < baseLine.length; ++i) {
        const similarity = await compareAnswers(
            model,
            baseLine[i].answer,
            results[i].answer,
        );
        comparisons.push({
            baseLine: baseLine[i],
            answer: results[i].answer,
            similarity,
        });
    }
    return comparisons;
}

export async function compareAnswers(
    model: TextEmbeddingModel,
    baseLine: AnswerResponse | undefined,
    answer: AnswerResponse | undefined,
): Promise<number> {
    if (baseLine && answer) {
        if (baseLine.type !== answer.type) {
            return 0;
        }
        switch (baseLine.type) {
            default:
                break;
            case "Answered":
                return stringSimilarity(model, baseLine.answer, answer.answer);
            case "NoAnswer":
                return stringSimilarity(
                    model,
                    baseLine.whyNoAnswer,
                    answer.whyNoAnswer,
                );
        }
    } else if (baseLine === undefined && answer === undefined) {
        return 1.0;
    }
    return 0;
}
