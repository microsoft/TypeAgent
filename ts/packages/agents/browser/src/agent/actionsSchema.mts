// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type BrowserActions =
    | OpenWebPage
    | CloseWebPage
    | SwitchTabs
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
    | ChangeSearchProvider
    | LookupAndAnswerInternet
    | FindImageAction;

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
        // Enum indicating if the page to open in the new tab or the current tab.
        // Default value is "current"
        tab: "new" | "current" | "existing";
    };
};

// Switch to a different tab
export type SwitchTabs = {
    actionName: "switchTabs";
    parameters: {
        tabDescription: string;
        // The numerical index referred to by the descripton if applicable.  (i.e. first = 1, second = 2, etc.)
        tabIndex?: number;
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

// The user request is a question about general knowledge that can be found from the internet.
// (e.g. "what is the current price of Microsoft stock?")
// look up for contemporary internet information including sports scores, news events, or current commerce offerings, use the lookups parameter to request a lookup of the information on the user's behalf; the assistant will generate a response based on the lookup results
// Lookup *facts* you don't know or if your facts are out of date.
// E.g. stock prices, time sensitive data, etc
// the search strings to look up on the user's behalf should be specific enough to return the correct information
// it is recommended to include the same entities as in the user request
export type LookupAndAnswerInternet = {
    actionName: "lookupAndAnswerInternet";
    parameters: {
        // the original request of the user
        originalRequest: string;
        // the internet search terms to use
        internetLookups: string[];
        // specific sites to look up in.
        sites?: string[];
    };
};

// Choose this action if the user wants to "see", "show", "find", "lookup" pictures/images/photos/memes or otherwise requesting visual output
// Finds images on the internet to show the user
// if the user asks doesn't specify a quantity, randomly select anywhere between 3 and 10 images
export type FindImageAction = {
    actionName: "findImageAction";
    parameters: {
        // the original request of the user
        originalRequest: string;
        // the search term for the image(s) to find
        searchTerm: string;
        // the number of images to show the user
        numImages: number;
    };
};
