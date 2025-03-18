// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type BrowserActions =
    | OpenTab
    | CloseTab
    | SwitchToTabByText
    | SwitchToTabByPosition
    | CloseWindow
    | GoBack
    | GoForward
    | ScrollDown
    | ScrollUp
    | FollowLinkByText
    | FollowLinkByPosition
    | OpenFromHistory
    | OpenFromBookmarks
    | AddToBookmarks
    | Search
    | ReadPageContent
    | StopReadPageContent
    | ZoomIn
    | ZoomOut
    | ZoomReset
    | CaptureScreenshot
    | ReloadPage;

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

export type Search = {
    actionName: "search";
    parameters: {
        query?: string;
    };
};

export type GoBack = {
    actionName: "goBack";
};

export type GoForward = {
    actionName: "goForward";
};

export type ScrollDown = {
    actionName: "scrollDown";
};

export type ScrollUp = {
    actionName: "scrollUp";
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

// follow a link on the page to open a related page or article
// Example:
//  user: Open the Haiti link
//  agent: {
//     "actionName": "followLinkByText",
//     "parameters": {
//        "keywords": "Haiti"
//     }
//  }
export type FollowLinkByText = {
    actionName: "followLinkByText";
    parameters: {
        keywords: string; // text that shows up as part of the link. Remove filler words such as "the", "article", "link","page" etc.
        openInNewTab?: boolean;
    };
};

export type FollowLinkByPosition = {
    actionName: "followLinkByPosition";
    parameters: {
        position: number;
        openInNewTab?: boolean;
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

export type ZoomIn = {
    actionName: "zoomIn";
};

export type ZoomOut = {
    actionName: "zoomOut";
};

export type ZoomReset = {
    actionName: "zoomReset";
};

export type AddToBookmarks = {
    actionName: "addToBookmarks";
    parameters: {
        url: string;
    };
};

export type ReadPageContent = {
    actionName: "readPage";
};

export type StopReadPageContent = {
    actionName: "stopReadPage";
};

export type CaptureScreenshot = {
    actionName: "captureScreenshot";
};

export type ReloadPage = {
    actionName: "reloadPage";
};

export interface ApproxDatetime {
    // Default: "unknown"
    displayText: string;
    // If precise timestamp can be set
    timestamp?: string;
}
