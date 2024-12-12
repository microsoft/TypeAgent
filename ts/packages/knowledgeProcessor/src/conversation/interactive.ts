// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "assert";
import { ChatUserInterface, MessageSourceRole } from "typeagent";
import { error, PromptSection, Result, success } from "typechat";

/**
 * Interact with a user to refine a value
 * Steps:
 *  - translate the user input + past history of user inputs into a value
 *  - evaluate the quality of the translated value. This might involve:
 *      - further transformations
 *      - actually running queries etc (if the translated object is a query for example)
 *  - If the evaluation says that further user input may be needed, return a followup message for the user
 * @param ux
 * @param initialUserInput
 * @param value
 * @param translate
 * @param evaluate
 * @param maxAttempts
 * @returns
 */
export async function interactivelyProcessUserInput(
    ux: ChatUserInterface,
    initialUserInput: string,
    value: any | undefined,
    translate: (
        userInput: string,
        previousInput: PromptSection[],
    ) => Promise<Result<any>>,
    evaluate: (
        userInput: string,
        previousInput: PromptSection[],
        value: any,
    ) => Promise<TranslationEvaluation>,
    maxAttempts: number = 3,
): Promise<Result<any> | undefined> {
    let previousUserInputs: PromptSection[] = [];
    let userInput: string | undefined = initialUserInput;
    let attempt = 1;
    while (true) {
        if (!value) {
            assert(userInput);
            const translationResult = await translate(
                userInput,
                previousUserInputs,
            );
            if (!translationResult.success) {
                return translationResult;
            }
            value = translationResult.data;
        }
        // Evaluate the value
        const evaluationResult = await evaluate(
            userInput,
            previousUserInputs,
            value,
        );
        if (!evaluationResult.retVal.success) {
            return evaluationResult.retVal;
        }
        if (!evaluationResult.followUpMessageForUser) {
            // We did not any follow ups for the user. Stop and return
            value = evaluationResult.retVal.data;
            break;
        }
        if (attempt === maxAttempts) {
            break;
        }
        previousUserInputs.push({
            role: MessageSourceRole.user,
            content: userInput,
        });
        // Get additional input from the user
        userInput = await ux.getInput(evaluationResult.followUpMessageForUser);
        if (!userInput) {
            // User did not provide any further input. So we stop interactive refinement
            break;
        }
        // Going to try get a fresh value using user input + past inputs
        value = undefined;
        ++attempt;
    }

    return value
        ? success(value)
        : error(`Exceeded max attempts: ${maxAttempts}`);
}

export type TranslationEvaluation = {
    retVal: Result<any>;
    followUpMessageForUser?: string | undefined;
};
