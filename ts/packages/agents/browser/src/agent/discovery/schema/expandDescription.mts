// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type SelectElementByText = {
    actionName: "selectElementByText";
    parameters: {
        cssSelector: string;
        text: string;
        elementType?: string;
    };
};

export type EnterText = {
    actionName: "enterText";
    parameters: {
        cssSelector: string;
        text: string;
    };
};

// This is used on pages where the user can type anywhere in the document body
// and the page captures input
export type EnterTextAtPageScope = {
    actionName: "EnterTextAtPageScope";
    parameters: {
        text: string;
    };
};

export type SelectValueFromDropdown = {
    actionName: "selectValueFromDropdown";
    parameters: {
        cssSelector: string;
        valueText: string;
    };
};

export type ClickOnButton = {
    actionName: "clickOnButton";
    parameters: {
        cssSelector: string;
        // the displayed text of the button to click on
        buttonText: string;
    };
};

export type ClickOnElement = {
    actionName: "clickOnElement";
    parameters: {
        cssSelector: string;
        // the displayed text of the element to click on
        elementText: string;
    };
};

export type ClickOnLink = {
    actionName: "ClickOnLink";
    parameters: {
        cssSelector: string;
        linkText: string;
    };
};

export type PageActions =
    | SelectElementByText
    | EnterText
    | SelectValueFromDropdown
    | ClickOnButton
    | ClickOnElement
    | ClickOnLink;

export type PageActionsList = {
    planName: string;
    description: string;
    actions: PageActions[];
};
