// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import { execBatch, execGetAnswerCommand } from "./memoryCommands.js";
import { KnowproContext } from "./knowproContext.js";
import { Result, success } from "typechat";
import { TextEmbeddingModel } from "aiclient";
import {
    dotProduct,
    generateTextEmbeddingsWithRetry,
    writeJsonFile,
} from "typeagent";

export type QuestionAnswer = {
    question: string;
    answer: string;
};

export async function getAnswerBatch(
    context: KnowproContext,
    batchFilePath: string,
    destFilePath?: string,
    cb?: (index: number, qa: QuestionAnswer) => void,
): Promise<Result<QuestionAnswer[]>> {
    const results = await execBatch(batchFilePath, async (index, args) => {
        const response = await getQuestionAnswer(context, args);
        if (response.success && cb) {
            cb(index, response.data);
        }
        return response;
    });
    if (results.success && destFilePath) {
        await writeJsonFile(destFilePath, results.data);
    }
    return results;
}

export async function compareQuestionAnswer(
    qa: QuestionAnswer,
    expected: QuestionAnswer,
    similarityModel: TextEmbeddingModel,
): Promise<number> {
    if (qa.question !== expected.question) {
        return 0;
    }
    if (qa.answer === expected.answer) {
        return 1.0;
    }
    const embeddings = await generateTextEmbeddingsWithRetry(similarityModel, [
        qa.answer,
        expected.answer,
    ]);
    return dotProduct(embeddings[0], embeddings[1]);
}

async function getQuestionAnswer(
    context: KnowproContext,
    args: string[],
): Promise<Result<QuestionAnswer>> {
    const response = await execGetAnswerCommand(context, args);
    if (!response.searchResponse.searchResults.success) {
        return response.searchResponse.searchResults;
    }
    if (!response.answerResponses.success) {
        return response.answerResponses;
    }
    const answer = flattenAnswers(response.answerResponses.data);
    const qa: QuestionAnswer = {
        question: response.searchResponse.debugContext.searchText,
        answer,
    };
    return success(qa);
}

function flattenAnswers(answerResponses: kp.AnswerResponse[]) {
    let answers: string[] = [];
    for (const answerResponse of answerResponses) {
        const answer =
            answerResponse.type === "Answered"
                ? answerResponse.answer
                : answerResponse.whyNoAnswer;
        if (answer) {
            answers.push(answer);
        }
    }
    return answers.join("\n");
}
