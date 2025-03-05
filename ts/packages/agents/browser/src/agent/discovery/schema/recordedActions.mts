// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// This captures the parameters for a user intent type
export type UserIntentParameter = {
    // a concise name for the parameter, in camelCase. This should only contain alphanumeric characters
    shortName: string;
    // a longer, descriptive name for the parameter. This value can contain non-alphanumeric characters
    name: string;
    // The valid values are "string", "number" and "boolean"
    type: string;
    // The default value for the parameter. If this value is set based on a HTML
    // page, check whether the target element has a default value. For dropdown elements, use the
    // selected value for this entry
    defaultValue?: any;
    description: string;
    // Indicates whether a parameter is required. If a parameter has a default value
    // then it is not required.
    required: boolean;
};

export type UserIntent = {
    // a concise name for the action, in camelCase
    actiontName: string;
    // a consise list of the parameters that should be captured from the user in order to implenent this action
    parameters: UserIntentParameter[];
};

export type WebPlan = {
    webPlanName: string;
    description: string;
    parameters: {
        actionName: string;
        stepsListId: string;
    };
};

export type SelectElementByText = {
    actionName: "selectElementByText";
    parameters: {
        // the shortName of the UserIntentParameter to use for this value
        text: string;
        elementType?: string;
    };
};

export type EnterText = {
    actionName: "enterText";
    parameters: {
        // the shortName of the UserIntentParameter to use for this value
        text: string;
    };
};

export type SelectValueFromDropdown = {
    actionName: "selectValueFromDropdown";
    parameters: {
        // the shortName of the UserIntentParameter to use for this value
        valueTextParameter: string;
    };
};

export type ClickOnButton = {
    actionName: "clickOnButton";
    parameters: {
        // the shortName of the UserIntentParameter to use for this value
        buttonText: string;
    };
};

export type ClickOnLink = {
    actionName: "ClickOnLink";
    parameters: {
        // the shortName of the UserIntentParameter to use for this value
        linkTextParameter: string;
    };
};

export type PageManipulationActions =
    | SelectElementByText
    | EnterText
    | SelectValueFromDropdown
    | ClickOnButton
    | ClickOnLink;

export type PageManipulationActionsList = {
    planName: string;
    description: string;
    intentSchemaName: string;
    steps: PageManipulationActions[];
};
