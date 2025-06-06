// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type BrowserActions =
    | OpenWebPage
    | CloseWebPage
    | GoBack
    | GoForward
    | ScrollDown
    | ScrollUp
    | FollowLinkByText
    | FollowLinkByPosition
    | Search
    | ReadPageContent
    | StopReadPageContent
    | ZoomIn
    | ZoomOut
    | ZoomReset
    | CaptureScreenshot
    | ReloadPage;

// show/open/display web page in the current view.
export type OpenWebPage = {
    actionName: "openWebPage";
    parameters: {
        // Alias or URL for the site of the open.
        site:
            | "paelobiodb"
            | "crossword"
            | "commerce"
            | "montage"
            | "markdown"
            | "planViewer"
            | "turtleGraphics"
            | string;
    };
};

// Close the current web site view
export type CloseWebPage = {
    actionName: "closeWebPage";
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

export type ZoomIn = {
    actionName: "zoomIn";
};

export type ZoomOut = {
    actionName: "zoomOut";
};

export type ZoomReset = {
    actionName: "zoomReset";
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
