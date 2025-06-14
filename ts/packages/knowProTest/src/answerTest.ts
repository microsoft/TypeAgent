// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import { execBatch, execGetAnswerCommand } from "./memoryCommands.js";
import { KnowproContext } from "./knowproContext.js";
import { Result, success } from "typechat";

export type QuestionAnswer = {
    question: string;
    answers: kp.AnswerResponse[];
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
            answers: response.answerResponses.data,
        };
        return success(qa);
    });
    return results;
}
