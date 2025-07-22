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
    | ReloadPage
    | ImportWebsiteData
    | SearchWebsites
    | GetWebsiteStats;

export type WebPage = string;
export type BrowserEntities = WebPage;

// show/open/display web page in the current view.
export type OpenWebPage = {
    actionName: "openWebPage";
    parameters: {
        // Name or description of the site to search for and open
        // Do NOT put URL here unless the user request specified the URL.
        site:
            | "paleobiodb"
            | "crossword"
            | "commerce"
            | "montage"
            | "markdown"
            | "planViewer"
            | "turtleGraphics"
            | WebPage;
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

// Import website data from browser history, bookmarks, or reading list
export type ImportWebsiteData = {
    actionName: "importWebsiteData";
    parameters: {
        // Which browser to import from
        source: "chrome" | "edge";
        // What type of data to import
        type: "history" | "bookmarks";
        // Maximum number of items to import
        limit?: number;
        // How many days back to import (for history)
        days?: number;
        // Specific bookmark folder to import (for bookmarks)
        folder?: string;
        // Enhancement options
        extractContent?: boolean;
        enableIntelligentAnalysis?: boolean;
        enableActionDetection?: boolean;
        extractionMode?: "basic" | "content" | "actions" | "full";
        maxConcurrent?: number;
        contentTimeout?: number;
    };
};

// Search through imported website data
export type SearchWebsites = {
    actionName: "searchWebsites";
    parameters: {
        // The original user request
        originalUserRequest: string;
        // Search query terms
        query: string;
        // Filter by domain
        domain?: string;
        // How to sort by time, if temporal intent present
        temporalSort: "ascend" | "descend" | "none";
        // How to sort by frequency of visit, if required
        frequencySort: "ascend" | "descend" | "none";
        // Filter by page type (news, commerce, social, etc.)
        pageType?: string;
        // Filter by source (bookmark, history)
        source?: "bookmark" | "history";
        // Maximum number of results
        limit?: number;
        // Minimum relevance score (0-1)
        minScore?: number;
    };
};

// Get statistics about imported website data
export type GetWebsiteStats = {
    actionName: "getWebsiteStats";
    parameters?: {
        // Group stats by domain, pageType, or source
        groupBy?: "domain" | "pageType" | "source";
        // Limit number of groups returned
        limit?: number;
    };
};
