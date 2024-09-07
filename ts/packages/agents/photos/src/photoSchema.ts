// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type PhotoAction = AnswerImageQuestionAction | UnknownAction;

// answers a question about an image that was sent by the user
export type AnswerImageQuestionAction = {
    actionName: "answerImageQuestion";
    parameters: {
        // the question asked by the user about the image
        questionText: string;
    };
};

// if the user types text that can not easily be understood as a list action, this action is used
export interface UnknownAction {
    actionName: "unknown";
    parameters: {
        // text typed by the user that the system did not understand
        text: string;
    };
}
