// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type DisabledBrowserActions = Search | SearchWebMemories;
export type BrowserActions =
    | OpenWebPage
    | CloseWebPage
    | CloseAllWebPages
    | ChangeTabs
    | GoBack
    | GoForward
    | ScrollDown
    | ScrollUp
    | FollowLinkByText
    | FollowLinkByPosition
    | ReadPageContent
    | StopReadPageContent
    | ZoomIn
    | ZoomOut
    | ZoomReset
    | CaptureScreenshot
    | ReloadPage
    | GetWebsiteStats
    | OpenSearchResult
    | ChangeSearchProvider
    | SearchImageAction
    | EnterTextInElement
    | SetDropdownValue
    | ClickOnElement
    | AwaitPageLoad
    | GetHTML
    | GetElementByDescription
    | IsPageStateMatched
    | QueryPageContent
    | DownloadImage;

export type WebSearchResult = string;
export type BrowserEntities = WebPageMoniker | WebSearchResult;

// A web site name OR search terms for a specific web page.
// Do NOT convert search terms into a URL.
// If the user supplies a protocol with any URL (https://, ftp://, typeagent-browser://, etc.), use it as is.
// Fully qualified domain names provided by the user are assumed to have HTTP as the protocol.
export type WebPageMoniker = string;

// show/open/display web page in the current view.
export type OpenWebPage = {
    actionName: "openWebPage";
    parameters: {
        // Name/Description/search terms of the site to open
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
            | "chatView" // the chat view (a.k.a. conversation history, chat tab, chat viewer, etc.))
            | WebPageMoniker;
        // Enum indicating if the page to open in the new tab or the current tab.
        // Default value is "current"
        tab?: "new" | "current" | "existing";
    };
};

// Make another tab the active tab
export type ChangeTabs = {
    actionName: "changeTab";
    parameters: {
        tabDescription: string;
        // The numerical index referred to by the description if applicable.  (i.e. first = 1, second = 2, etc.)
        tabIndex?: number;
    };
};

// Close the current web site view
export type CloseWebPage = {
    actionName: "closeWebPage";
};

// Close all web page views
export type CloseAllWebPages = {
    actionName: "closeAllWebPages";
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

// Read the web page contents aloud
export type ReadPageContent = {
    actionName: "readPageContent";
};

export type StopReadPageContent = {
    actionName: "stopReadPageContent";
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

// Display a search results page for the specified query
// Do NOT default to search if the user request doesn't explicitly ask for a search
export type Search = {
    actionName: "search";
    parameters: {
        query?: string;
        newTab: boolean; // default is false;
    };
};

// Search web memories (unified search replacing queryWebKnowledge and searchWebsites)
// Do NOT default to search if the user request doesn't explicitly ask for a search
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

// Searches (finds) for images on the internet to show the user
// if the user asks doesn't specify a quantity, randomly select anywhere between 3 and 10 images
export type SearchImageAction = {
    actionName: "searchImageAction";
    parameters: {
        // the original request of the user
        originalRequest: string;
        // the search term for the image(s) to find
        searchTerm: string;
        // the number of images to show the user
        numImages: number;
    };
};

export type EnterTextInElement = {
    actionName: "enterTextInElement";
    parameters: {
        // the value to enter
        value: string;
        // the CSS selector for the element to enter text into
        cssSelector: string;
        // whether to submit the form after entering text
        submitForm?: boolean;
    };
};

export type SetDropdownValue = {
    actionName: "setDropdownValue";
    parameters: {
        // the value to enter
        optionLabel: string;
        // the CSS selector for the element to enter text into
        cssSelector: string;
    };
};

export type ClickOnElement = {
    actionName: "clickOnElement";
    parameters: {
        // the CSS selector for the element to click on
        cssSelector: string;
    };
};

export type AwaitPageLoad = {
    actionName: "awaitPageLoad";
};

export type GetHTML = {
    actionName: "getHTML";
    parameters: {
        fullHTML?: boolean;
        downloadAsFile?: boolean;
        extractText?: boolean;
        useTimestampIds?: boolean;
    };
};

// Find an element on the page using natural language description.
// Uses LLM to understand page structure and locate the element.
// Prefer this over parsing raw HTML when you don't know the CSS selector.
export type GetElementByDescription = {
    actionName: "getElementByDescription";
    parameters: {
        // Natural language description of the element to find
        elementDescription: string;

        // Optional hint about element type to narrow search
        // Values: "button", "input", "link", "heading", "text", etc.
        elementType?: string;
    };
};

// Verify if the current page state matches an expected condition.
// Uses LLM to understand page semantics and compare to expectation.
// Prefer this over parsing raw HTML for state verification.
export type IsPageStateMatched = {
    actionName: "isPageStateMatched";
    parameters: {
        // Expected page state description in natural language
        expectedStateDescription: string;
    };
};

// Query page content to answer a question using LLM.
// Extracts information from the page without needing to parse HTML.
// Prefer this over parsing raw HTML for data extraction.
export type QueryPageContent = {
    actionName: "queryPageContent";
    parameters: {
        // Question about page content in natural language
        query: string;
    };
};

// Download an image from the current page to the local downloads folder.
export type DownloadImage = {
    actionName: "downloadImage";
    parameters: {
        // CSS selector to identify the image element
        cssSelector?: string;
        // Natural language description to find the image by alt text or title
        imageDescription?: string;
        // Filename to save the image as (defaults to image_<timestamp>.png)
        filename?: string;
    };
};
