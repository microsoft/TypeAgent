// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import { BatchCallback, execGetAnswerCommand } from "./memoryCommands.js";
import { getCommandArgs } from "./common.js";
import { KnowproContext } from "./knowproContext.js";
import { Result, success } from "typechat";
import { TextEmbeddingModel } from "aiclient";
import {
    dotProduct,
    generateTextEmbeddingsWithRetry,
    readJsonFile,
    writeJsonFile,
} from "typeagent";
import { getBatchFileLines } from "interactive-app";
import { SimilarityComparison } from "./types.js";

export type QuestionAnswer = {
    question: string;
    answer: string;
    cmd?: string | undefined;
};

export async function getAnswerBatch(
    context: KnowproContext,
    batchFilePath: string,
    destFilePath?: string,
    cb?: BatchCallback<QuestionAnswer>,
): Promise<Result<QuestionAnswer[]>> {
    const batchLines = getBatchFileLines(batchFilePath);
    const results: QuestionAnswer[] = [];
    for (let i = 0; i < batchLines.length; ++i) {
        const cmd = batchLines[i];
        const args = getCommandArgs(cmd);
        if (args.length === 0) {
            continue;
        }
        const response = await getQuestionAnswer(context, args);
        if (!response.success) {
            return response;
        }
        response.data.cmd = cmd;
        results.push(response.data);
        if (cb) {
            cb(response.data, i, batchLines.length);
        }
    }
    if (destFilePath) {
        await writeJsonFile(destFilePath, results);
    }
    return success(results);
}

export type QuestionAnswerComparison = {
    score: number;
    actual: QuestionAnswer;
    expected: QuestionAnswer;
};

export async function verifyQuestionAnswerBatch(
    context: KnowproContext,
    batchFilePath: string,
    similarityModel: TextEmbeddingModel,
    cb?: BatchCallback<SimilarityComparison<QuestionAnswer>>,
): Promise<Result<SimilarityComparison<QuestionAnswer>[]>> {
    let results: SimilarityComparison<QuestionAnswer>[] = [];
    let questionAnswers = await readJsonFile<QuestionAnswer[]>(batchFilePath);
    if (questionAnswers === undefined || questionAnswers.length === 0) {
        return success(results);
    }
    for (let i = 0; i < questionAnswers.length; ++i) {
        const expected = questionAnswers[i];
        const args = getCommandArgs(expected.cmd);
        if (args.length === 0) {
            continue;
        }
        const response = await getQuestionAnswer(context, args);
        if (!response.success) {
            return response;
        }
        const actual = response.data;
        const score = await compareQuestionAnswer(
            actual,
            expected,
            similarityModel,
        );
        const result: SimilarityComparison<QuestionAnswer> = {
            actual,
            expected,
            score,
        };
        results.push(result);
        if (cb) {
            cb(result, i, questionAnswers.length);
        }
    }
    return success(results);
}

export async function compareQuestionAnswer(
    actual: QuestionAnswer,
    expected: QuestionAnswer,
    similarityModel: TextEmbeddingModel,
): Promise<number> {
    if (actual.question !== expected.question) {
        return 0;
    }
    const actualAnswer = actual.answer.toLowerCase();
    const expectedAnswer = expected.answer.toLowerCase();
    if (actualAnswer === expectedAnswer) {
        return 1.0;
    }
    const embeddings = await generateTextEmbeddingsWithRetry(similarityModel, [
        actualAnswer,
        expectedAnswer,
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
