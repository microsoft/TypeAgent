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
    | GetWebsiteStats
    | SearchWebMemories
    | OpenSearchResult
    | ChangeSearchProvider;

export type WebPage = string;
export type WebSearchResult = string;
export type BrowserEntities = WebPage | WebSearchResult;

// show/open/display web page in the current view.
export type OpenWebPage = {
    actionName: "openWebPage";
    parameters: {
        // Name/Description/search terms of the site to open
        // Do NOT put URL here unless the user request specified the URL.
        site:
            | "paleobiodb"
            | "crossword"
            | "commerce"
            | "montage"
            | "markdown"
            | "planViewer"
            | "turtleGraphics"
            | "annotationsLibrary"
            | "knowledgeLibrary"
            | "macrosLibrary"
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

// Search web memories (unified search replacing queryWebKnowledge and searchWebsites)
export type SearchWebMemories = {
    actionName: "searchWebMemories";
    parameters: {
        // The original user request - overrides query if provided
        originalUserRequest?: string;
        query: string;
        searchScope?: "current_page" | "all_indexed";

        // Search configuration
        limit?: number;
        minScore?: number;
        exactMatch?: boolean;

        // Processing options (consumer controls cost)
        generateAnswer?: boolean; // Default: true
        includeRelatedEntities?: boolean; // Default: true
        includeRelationships?: boolean; // Default: false (expensive)
        enableAdvancedSearch?: boolean; // Use advanced patterns

        // Advanced options
        knowledgeTopK?: number;
        chunking?: boolean;
        fastStop?: boolean;
        combineAnswers?: boolean;
        choices?: string; // Multiple choice (semicolon separated)
        debug?: boolean;
    };
};

// Open a specific search result from previous search
export type OpenSearchResult = {
    actionName: "openSearchResult";
    parameters: {
        // Position/index of the search result (1-based)
        position?: number;
        // Name or title of the search result to open
        title?: string;
        // URL of the search result to open (if user specifies exact URL)
        url?: string;
        // Open in new tab (default: false)
        openInNewTab?: boolean;
    };
};

// change the default search provider
export type ChangeSearchProvider = {
    actionName: "changeSearchProvider";
    parameters: {
        // The name of the search provider to switch to
        name: string;
    };
};
