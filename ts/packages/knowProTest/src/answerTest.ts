// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import { execGetAnswerCommand } from "./memoryCommands.js";
import { getCommandArgs } from "./common.js";
import { KnowproContext } from "./knowproContext.js";
import { Result, success } from "typechat";
import { TextEmbeddingModel } from "aiclient";
import {
    dotProduct,
    generateTextEmbeddingsWithRetry,
    readJsonFile,
    ScoredItem,
    writeJsonFile,
} from "typeagent";
import { getBatchFileLines } from "interactive-app";

export type QuestionAnswer = {
    question: string;
    answer: string;
    cmd?: string | undefined;
};

export async function getAnswerBatch(
    context: KnowproContext,
    batchFilePath: string,
    destFilePath?: string,
    cb?: (index: number, qa: QuestionAnswer) => void,
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
            cb(i, response.data);
        }
    }
    if (destFilePath) {
        await writeJsonFile(destFilePath, results);
    }
    return success(results);
}

export async function verifyQuestionAnswerBatch(
    context: KnowproContext,
    batchFilePath: string,
): Promise<ScoredItem<QuestionAnswer>[]> {
    let questionAnswers = await readJsonFile<QuestionAnswer[]>(batchFilePath);
    if (questionAnswers === undefined || questionAnswers.length === 0) {
        return [];
    }
    questionAnswers = questionAnswers.filter((q) => q.cmd && q.cmd.length > 0);
    for (let i = 0; i < questionAnswers.length; ++i) {}
    return [];
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
