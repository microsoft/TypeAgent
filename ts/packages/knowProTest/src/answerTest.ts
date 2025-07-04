// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import { execGetAnswerRequest } from "./knowproCommands.js";
import { BatchCallback } from "./types.js";
import { getCommandArgs, queryError } from "./common.js";
import { KnowproContext } from "./knowproContext.js";
import { error, Result, success } from "typechat";
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
    hasNoAnswer?: boolean | undefined;
};

export async function runAnswerBatch(
    context: KnowproContext,
    batchFilePath: string,
    destFilePath?: string,
    cb?: BatchCallback<Result<QuestionAnswer>>,
    stopOnError: boolean = false,
): Promise<Result<QuestionAnswer[]>> {
    const batchLines = getBatchFileLines(batchFilePath);
    const results: QuestionAnswer[] = [];
    for (let i = 0; i < batchLines.length; ++i) {
        const cmd = batchLines[i];
        const args = getCommandArgs(cmd);
        if (args.length === 0) {
            continue;
        }
        let response = await getQuestionAnswer(context, args);
        if (response.success) {
            response.data.cmd = cmd;
        } else {
            response = queryError(cmd, response);
        }
        if (cb) {
            cb(response, i, batchLines.length);
        }
        if (response.success) {
            results.push(response.data);
        } else if (stopOnError) {
            return response;
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
    cb?: BatchCallback<Result<SimilarityComparison<QuestionAnswer>>>,
    stopOnError: boolean = false,
): Promise<Result<SimilarityComparison<QuestionAnswer>[]>> {
    let results: SimilarityComparison<QuestionAnswer>[] = [];
    let questionAnswers = await readJsonFile<QuestionAnswer[]>(batchFilePath);
    if (questionAnswers === undefined || questionAnswers.length === 0) {
        return error(`${batchFilePath} does not contain QuestionAnswer[]`);
    }

    for (let i = 0; i < questionAnswers.length; ++i) {
        const expected = questionAnswers[i];
        const args = getCommandArgs(expected.cmd);
        if (args.length === 0) {
            continue;
        }
        let response = await getQuestionAnswer(context, args);
        if (response.success) {
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
                cb(success(result), i, questionAnswers.length);
            }
        } else {
            response = queryError(expected.cmd!, response);
            if (cb) {
                cb(response, i, questionAnswers.length);
            }
            if (stopOnError) {
                return response;
            }
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
    const response = await execGetAnswerRequest(context, args);
    if (!response.searchResponse.searchResults.success) {
        return response.searchResponse.searchResults;
    }
    if (!response.answerResponses.success) {
        return response.answerResponses;
    }
    const answer = flattenAnswers(response.answerResponses.data);
    const hasNoAnswer = response.answerResponses.data.some(
        (a) => a.type === "NoAnswer",
    );
    const qa: QuestionAnswer = {
        question: response.searchResponse.debugContext.searchText,
        answer,
        hasNoAnswer,
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
