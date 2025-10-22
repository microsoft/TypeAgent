// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Schema for generating suggested questions about web page content
 * Following TypeChat/TypeAgent pattern for structured LLM interactions
 */

export type QuestionType =
    | "factual" // Direct questions about facts on the page
    | "analytical" // Questions that require analysis or interpretation
    | "comparative" // Questions comparing this content to other knowledge
    | "exploratory" // Questions that explore related concepts or connections
    | "practical"; // Questions about how to apply or use the information

export type QuestionScope =
    | "page" // Questions specifically about this page's content
    | "related" // Questions about content related to this page
    | "broader"; // Questions that connect to broader knowledge graph

export type SuggestedQuestion = {
    // The question text that users will see
    question: string;

    // The type of question this represents
    type: QuestionType;

    // Whether this question is about the current page or broader knowledge
    scope: QuestionScope;

    // Brief explanation of why this question would be valuable
    reasoning: string;

    // Confidence that this question would be useful (0.0 to 1.0)
    confidence: number;
};

/**
 * Response containing generated questions for a web page
 */
export type PageQuestionResponse = {
    // Array of suggested questions for the user
    questions: SuggestedQuestion[];

    // Summary of the content that questions are based on
    contentSummary: string;

    // Key topics that influenced question generation
    primaryTopics: string[];

    // Important entities that influenced question generation
    primaryEntities: string[];
};
