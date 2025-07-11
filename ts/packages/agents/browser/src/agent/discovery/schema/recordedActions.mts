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

    // Indicates whether a parameter value must be provided by the end-user.
    // NOTE: Parameters that are fixed on the page (such as the text of a button or link) should not be
    // marked as required fields.
    required: boolean;
};

// IMPORTANT: The user intent type only includes the actionName and parameters properties.
export type UserIntent = {
    // a concise name for the action, in camelCase. This should be based on the goal of the task the user is running.
    actionName: string;
    // a consise list of the parameters that should be captured from the user in order to implenent this action
    parameters: UserIntentParameter[];
};

export type SelectElementByText = {
    actionName: "selectElementByText";
    // a short user-friendly description of the operation e.g. select name
    description: string;
    parameters: {
        // IMPORTANT: the shortName of the UserIntentParameter to use for this value
        text: string;
        elementType?: string;
    };
};

export type EnterText = {
    actionName: "enterText";
    // a short user-friendly description of the operation e.g. enter name
    description: string;
    parameters: {
        // IMPORTANT: the shortName of the UserIntentParameter to use for this value
        textParameter: string;
    };
};

// This is used on pages where the user can type anywhere in the document body
// and the page captures input
export type EnterTextAtPageScope = {
    actionName: "enterTextAtPageScope";
    // a short user-friendly description of the operation e.g. enter name
    description: string;
    parameters: {
        // IMPORTANT: the shortName of the UserIntentParameter to use for this value
        textParameter: string;
    };
};

export type SelectValueFromDropdown = {
    actionName: "selectValueFromDropdown";
    // a short user-friendly description of the operation e.g. select month
    description: string;
    parameters: {
        // IMPORTANT: the shortName of the UserIntentParameter to use for this value
        valueTextParameter: string;
    };
};

export type ClickOnButton = {
    actionName: "clickOnButton";
    // a short user-friendly description of the operation e.g. click on home link
    description: string;
    parameters: {
        // the displayed text of the button to click on
        buttonText: string;
    };
};

export type ClickOnElement = {
    actionName: "clickOnElement";
    // a short user-friendly description of the operation e.g. click on home link
    description: string;
    parameters: {
        // the displayed text of the element to click on
        elementText: string;
    };
};

export type ClickOnLink = {
    actionName: "ClickOnLink";
    // a short user-friendly description of the operation e.g. click on home link
    description: string;
    parameters: {
        // the shortName of the UserIntentParameter to use for this value
        linkTextParameter: string;
    };
};

export type PageManipulationActions =
    | SelectElementByText
    | EnterText
    | EnterTextAtPageScope
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
