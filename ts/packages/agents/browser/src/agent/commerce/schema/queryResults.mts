// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Result of getElementByDescription action
 * Contains element information extracted from the page
 */
export type ElementDescriptionResult = {
    // Whether the element was found
    found: boolean;

    // Name/description of the element (e.g., "Home button", "Search input")
    elementName: string;

    // HTML fragment of the element (full outerHTML)
    elementHtml?: string;

    // CSS selector to locate the element
    // Prefer ID-based selectors when available
    elementCssSelector?: string;

    // Additional metadata about the element
    elementType?: string; // e.g., "button", "input", "link"
    elementText?: string; // Visible text content
    elementAttributes?: Record<string, string>; // Key attributes

    // Reason if element not found
    notFoundReason?: string;
};

/**
 * Result of isPageStateMatched action
 * Indicates whether current page state matches expected state
 */
export type PageStateMatchResult = {
    // Whether the page state matches the expected state
    matched: boolean;

    // The current page state
    currentPageState: {
        pageType: string;
        description: string;
        keyElements?: string[]; // List of notable elements on page
        userActions?: string[]; // Possible user actions
    };

    // Detailed match information
    matchDetails?: {
        // Which aspects matched
        matchedAspects: string[];

        // Which aspects did not match
        unmatchedAspects: string[];

        // Confidence score (0.0 to 1.0)
        confidence: number;
    };

    // Human-readable explanation
    explanation: string;
};

/**
 * Result of queryPageContent action
 * Contains answer to user's question about page content
 */
export type PageContentQueryResult = {
    // Whether the query could be answered
    answered: boolean;

    // The answer text
    answerText?: string;

    // Supporting evidence from the page
    evidence?: {
        // Text snippets that support the answer
        relevantText: string[];

        // CSS selectors for elements containing the evidence
        sourceSelectors: string[];
    };

    // Confidence in the answer (0.0 to 1.0)
    confidence?: number;

    // Reason if query could not be answered
    unableToAnswerReason?: string;

    // Suggested next steps if answer is partial
    suggestedNextSteps?: string[];
};
