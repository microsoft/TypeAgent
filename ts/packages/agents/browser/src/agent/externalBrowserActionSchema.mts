// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ExternalBrowserActions =
    | OpenTab
    | CloseTab
    | CloseWindow
    | SwitchToTabByText
    | SwitchToTabByPosition
    | AddToBookmarks
    | OpenFromHistory
    | OpenFromBookmarks;

// This opens a new tab in an existing browser window.
// IMPORTANT: This does NOT launch new browser windows.
export type OpenTab = {
    actionName: "openTab";
    parameters: {
        url?: string; // full URL to website
        query?: string;
    };
};

// This closes a tab in an existing browser window.
// IMPORTANT: This does NOT close browser programs.
export type CloseTab = {
    actionName: "closeTab";
    parameters: {
        title?: string;
    };
};

export type CloseWindow = {
    actionName: "closeWindow";
    parameters: {
        title?: string;
    };
};

// Switch to an open tab, based on the tab's title
// Example:
//  user: Switch to the Haiti tab
//  agent: {
//     "actionName": "switchToTabByText",
//     "parameters": {
//        "keywords": "Haiti"
//     }
//  }
export type SwitchToTabByText = {
    actionName: "switchToTabByText";
    parameters: {
        keywords: string; // text that shows up as part of the tab title. Remove filler words such as "the", "article", "link","page" etc.
    };
};

export type SwitchToTabByPosition = {
    actionName: "switchToTabByPosition";
    parameters: {
        position: number;
    };
};

export type AddToBookmarks = {
    actionName: "addToBookmarks";
    parameters: {
        url: string;
    };
};

export type OpenFromHistory = {
    actionName: "openFromHistory";
    parameters: {
        keywords: string; // text that shows up as part of the link. Remove filler words such as "the", "article", "link","page" etc.
        startDate?: ApproxDatetime;
        endDate?: ApproxDatetime;
    };
};

export type OpenFromBookmarks = {
    actionName: "openFromBookmarks";
    parameters: {
        keywords: string; // text that shows up as part of the link. Remove filler words such as "the", "article", "link","page" etc.
    };
};

export interface ApproxDatetime {
    // Default: "unknown"
    displayText: string;
    // If precise timestamp can be set
    timestamp?: string;
}
