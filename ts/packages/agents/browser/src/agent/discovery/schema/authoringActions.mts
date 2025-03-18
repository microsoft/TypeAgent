// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type UpdateWebPlan = {
    actionName: "updateWebPlan";
    parameters: {
        userInput: string;
        nextPrompt?: string;
        // the proposed name for the plan
        webPlanName?: string;
        webPlanDescription?: string;
        // the list of plan steps provided by the user
        webPlanSteps?: string[];
        isPlanComplete?: boolean;
    };
};

export type PlanAuthoringActions = UpdateWebPlan;
