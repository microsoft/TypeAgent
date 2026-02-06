// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Result type definitions for browser semantic query actions.
 * These actions use LLM to understand page content and answer queries.
 */

/**
 * Result from getElementByDescription action
 */
export type ElementDescriptionResult = {
    // Whether the element was found
    found: boolean;

    // Name/description of the element
    elementName: string;

    // Full outer HTML of the element (if found)
    elementHtml?: string;

    // CSS selector to locate the element (if found)
    // Prefers: ID > data-* attributes > classes
    elementCssSelector?: string;

    // Type of element (button, input, link, etc.)
    elementType?: string;

    // Text content of the element
    elementText?: string;

    // Element attributes as key-value pairs
    elementAttributes?: Record<string, string>;

    // Reason why element was not found (if not found)
    notFoundReason?: string;
};

/**
 * Result from isPageStateMatched action
 */
export type PageStateMatchResult = {
    // Whether the current page state matches the expected state
    matched: boolean;

    // Description of the current page state
    currentPageState: {
        // Type of page (e.g., "product page", "shopping cart", "search results")
        pageType: string;

        // Natural language description of current state
        description: string;

        // Key elements visible on the page
        keyElements?: string[];

        // User actions available on the page
        userActions?: string[];
    };

    // Details about what matched/didn't match (if comparison was made)
    matchDetails?: {
        // Aspects that matched the expected state
        matchedAspects: string[];

        // Aspects that didn't match the expected state
        unmatchedAspects: string[];

        // Confidence score (0.0 - 1.0)
        confidence: number;
    };

    // Natural language explanation of the match result
    explanation: string;
};

/**
 * Result from queryPageContent action
 */
export type PageContentQueryResult = {
    // Whether the question was answered
    answered: boolean;

    // The answer to the question (if answered)
    answerText?: string;

    // Evidence supporting the answer
    evidence?: {
        // Relevant text snippets from the page
        relevantText: string[];

        // CSS selectors pointing to source elements
        sourceSelectors: string[];
    };

    // Confidence score (0.0 - 1.0) for the answer
    confidence?: number;

    // Reason why the question couldn't be answered (if not answered)
    unableToAnswerReason?: string;

    // Suggested next steps if unable to answer
    suggestedNextSteps?: string[];
};
