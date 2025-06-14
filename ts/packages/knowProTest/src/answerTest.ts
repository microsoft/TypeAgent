// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import { execBatch, execGetAnswerCommand } from "./memoryCommands.js";
import { KnowproContext } from "./knowproContext.js";
import { Result, success } from "typechat";
import { TextEmbeddingModel } from "aiclient";
import { dotProduct, generateTextEmbeddingsWithRetry } from "typeagent";

export type QuestionAnswer = {
    question: string;
    answer: string;
};

export async function getAnswerBatch(
    context: KnowproContext,
    batchFilePath: string,
): Promise<Result<QuestionAnswer[]>> {
    const results = await execBatch(batchFilePath, async (args) => {
        const response = await execGetAnswerCommand(context, args);
        if (!response.searchResponse.searchResults.success) {
            return response.searchResponse.searchResults;
        }
        if (!response.answerResponses.success) {
            return response.answerResponses;
        }
        const qa: QuestionAnswer = {
            question: response.searchResponse.debugContext.searchText,
            answer: flattenAnswers(response.answerResponses.data),
        };
        return success(qa);
    });
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

export async function compareAnswers(
    questionAnswers: QuestionAnswer[],
    expected: QuestionAnswer[],
    similarityModel: TextEmbeddingModel,
    threshold: number = 0.9,
): Promise<number[]> {
    if (questionAnswers.length !== expected.length) {
        throw new Error("Length mismatch");
    }
    let scores: number[] = [];
    for (let i = 0; i < questionAnswers.length; ++i) {
        scores.push(
            await compareQuestionAnswer(
                questionAnswers[i],
                expected[i],
                similarityModel,
            ),
        );
    }
    return scores;
}

function flattenAnswers(answerResponses: kp.AnswerResponse[]) {
    let answers: string[] = [];
    for (const answerResponse of answerResponses) {
        const answer =
            answerResponse.type === "Answered"
                ? answerResponse.answer
                : answerResponse.whyNoAnswer;
        if (answer) {
            answers.push(answerResponse.type);
        }
    }
    return answers.join("\n");
}
