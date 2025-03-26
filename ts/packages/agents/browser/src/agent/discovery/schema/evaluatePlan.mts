// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type WebPlanResult = {
    // message shown to the user. This may be a confirmation message that the task was completed,
    // or a message indicating the task was not completed and asking for more infomration from the user.
    message: string;
    // indicates whether the objective for the current plan has been met
    isTaskComplete: boolean;
    possibleUserFolloupActions?: string[];
};

export type WebPlanSuggestions = {
    // the list of plan steps that the agent suggest based on the current state of the page and the web plan goal.
    // Each entry is a clear, concise description of an operation that the user would run on a web page.
    sugggestedPlanSteps?: string[];

    // Set this field in cases where suggestedPlanSteps are provided. This will show a messge to the user
    // with a summary of suggested steps and ask them if they want to include these in the plan.
    message: string;
};
