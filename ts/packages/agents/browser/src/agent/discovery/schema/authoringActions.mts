// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CreateOrUpdateWebPlan = {
    actionName: "createOrUpdateWebPlan";
    parameters: {
        // This field echoes the last input from the user. The value is null if this is the first interaction with the user.
        userInput: string;
        // classify the user's request into one of these states
        userIntent:
            | "createNew"
            | "updateCurrentPlan"
            | "testCurrentPlan"
            | "savePlanAndExit";
        // use this field to ask for clarification from the user if needed
        nextPrompt?: string;
        // the proposed name for the plan
        webPlanName?: string;
        webPlanDescription?: string;
        // the list of plan steps provided by the user. Each entry is a clear, concise description of an operation
        // that the user would run on a web page.
        webPlanSteps?: string[];
        isPlanComplete?: boolean;
        // This field is set when the user wants to run the current plan. It captures the parameter values provided
        // by the user for the test run.
        // The value for this field is a JSON serialization of a dictionary whose properties are the required properties for this task
        taskRunParameters?: string;
    };
};

export type PlanAuthoringActions = CreateOrUpdateWebPlan;
