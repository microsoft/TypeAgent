// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type BrowserAutomationActions =
    | LaunchHiddenAutomationBrowser
    | LaunchStandaloneAutomationBrowser
    | CloseAutomationBrowser;

// Launch a hidden browser process for TypeAgent automation.
export type LaunchHiddenAutomationBrowser = {
    actionName: "launchHiddenAutomationBrowser";
};

// Launch a visible standalone browser process for TypeAgent automation.
export type LaunchStandaloneAutomationBrowser = {
    actionName: "launchStandaloneAutomationBrowser";
};

// Close the browser process launched for TypeAgent automation.
export type CloseAutomationBrowser = {
    actionName: "closeAutomationBrowser";
};
