// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatUserInterface, MessageSourceRole } from "typeagent";
import { PromptSection } from "typechat";

export async function interactivelyRefineValue<T extends object>(
    ux: ChatUserInterface,
    seedUserInput: string,
    obj: T | undefined,
    getQuestionForUser: (userInput: string, obj: T) => string | undefined,
    getObject: (
        userInput: string,
        context: PromptSection[],
    ) => Promise<T | undefined>,
): Promise<T | undefined> {
    const maxAttempts = 8;
    let chatHistory: PromptSection[] | undefined;
    let userInput: string | undefined = seedUserInput;
    for (let i = 0; i < maxAttempts; ++i) {
        if (obj) {
            const questionForUser = getQuestionForUser(userInput, obj);
            if (!questionForUser) {
                break;
            }
            userInput = await ux.getInput(questionForUser);
            if (!userInput) {
                break;
            }
        }
        if (!chatHistory) {
            chatHistory = [];
            chatHistory.push({
                role: MessageSourceRole.user,
                content: seedUserInput,
            });
        }
        obj = await getObject(userInput, chatHistory);
        chatHistory.push({
            role: MessageSourceRole.user,
            content: userInput,
        });
    }
    return obj;
}
