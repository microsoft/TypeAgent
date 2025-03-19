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

    // The text for the various options for this control. This is useful for HTML elements
    // that only accept a fixed set of values e.g. dropdown elements, radio-button lists etc.
    valueOptions?: string[];

    // The description for this parameter. Always include a list of Options as part of the description if the
    // HTML control only accepts a fixed set of values e.g. dropdown elements, radio-button lists etc.
    description: string;

    // Indicates whether a parameter is required. If a parameter has a default value
    // then it is not required.
    required: boolean;
};

export type UserIntent = {
    // a concise name for the action, in camelCase. This should be based on the goal of the task the user is running.
    actionName: string;
    // a consise list of the parameters that should be captured from the user in order to implenent this action
    parameters: UserIntentParameter[];
};

export type SelectElementByText = {
    actionName: "selectElementByText";
    parameters: {
        // IMPORTANT: the shortName of the UserIntentParameter to use for this value
        text: string;
        elementType?: string;
    };
};

export type EnterText = {
    actionName: "enterText";
    parameters: {
        // IMPORTANT: the shortName of the UserIntentParameter to use for this value
        textParameter: string;
    };
};

// This is used on pages where the user can type anywhere in the document body
// and the page captures input
export type EnterTextAtPageScope = {
    actionName: "EnterTextAtPageScope";
    parameters: {
        // IMPORTANT: the shortName of the UserIntentParameter to use for this value
        textParameter: string;
    };
};

export type SelectValueFromDropdown = {
    actionName: "selectValueFromDropdown";
    parameters: {
        // IMPORTANT: the shortName of the UserIntentParameter to use for this value
        valueTextParameter: string;
    };
};

export type ClickOnButton = {
    actionName: "clickOnButton";
    parameters: {
        // the displayed text of the button to click on
        buttonText: string;
    };
};

export type ClickOnElement = {
    actionName: "clickOnElement";
    parameters: {
        // the displayed text of the element to click on
        elementText: string;
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
    | ClickOnElement
    | ClickOnLink;

export type PageActionsPlan = {
    planName: string;
    description: string;
    // The actionName of the UserIntent associated with this plan
    intentSchemaName: string;
    steps: PageManipulationActions[];
};
