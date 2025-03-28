// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CreateOrUpdateWebPlan = {
    actionName: "createOrUpdateWebPlan";
    parameters: {
        // use this field to ask for clarification from the user if needed
        nextPrompt: string;
        // This is the USER-provided proposed name for the plan
        webPlanName: string;
        // This is the USER-provided description of what the task does. It describes the state of the page at the
        // begining of the task and the target state of the page at the end of the task.
        webPlanDescription: string;
        // the list of plan steps provided by the user. Each entry is a clear, concise description of an operation
        // that the user would run on a web page.
        webPlanSteps?: string[];
        // The parameter names for the values that must be provided when users invoke this web plan
        requiredParameterNames?: string[];
    };
};

export type RunCurrentWebPlan = {
    actionName: "runCurrentWebPlan";
    parameters: {
        // the proposed name for the plan
        webPlanName?: string;
        // Set this value baderd on the web plan name, description and steps. The goal defines the
        // expected state of the website/webpage when the task is completed.
        webPlanDescription?: string;
        // This field is set when the user wants to run the current plan. It captures the parameter values provided
        // by the user for the test run.
        // The value for this field is a JSON serialization of a dictionary whose properties are the required properties for this task
        taskRunParameters?: string;
    };
};

export type SaveCurrentWebPlan = {
    actionName: "saveCurrentWebPlan";
};

export type GetSuggestedSteps = {
    actionName: "getSuggestedSteps";
    parameters: {
        // the proposed name for the plan
        webPlanName?: string;
        // Set this value baderd on the web plan name, description and steps. The goal defines the
        // expected state of the website/webpage when the task is completed.
        webPlanDescription?: string;
        // the list of plan steps that the agent suggest based on the current state of the page and the web plan goal.
        // Each entry is a clear, concise description of an operation that the user would run on a web page.
        sugggestedPlanSteps?: string[];

        // use this field in cases where suggestedPlanSteps are provided. This will show a messge to the user
        // with a summary of suggested steps and ask them if they want to include these in the plan.
        message?: string;
    };
};

export type PlanAuthoringActions =
    | CreateOrUpdateWebPlan
    | RunCurrentWebPlan
    | SaveCurrentWebPlan
    | GetSuggestedSteps;
