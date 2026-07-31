// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type FeedbackAction =
    | ListFeedbackAction
    | SummarizeFeedbackAction
    | FilterFeedbackAction
    | ExportFeedbackAction
    | CountFeedbackAction;

// List recent user feedback entries.
export type ListFeedbackAction = {
    actionName: "listFeedback";
    parameters?: {
        limit?: number;
        includeAllEntries?: boolean;
    };
};

// Aggregate user feedback by rating and category.
export type SummarizeFeedbackAction = {
    actionName: "summarizeFeedback";
    parameters?: { categoryLimit?: number };
};

// Filter user feedback by rating, category, date range, and result limit.
export type FilterFeedbackAction = {
    actionName: "filterFeedback";
    parameters?: {
        rating?: "up" | "down" | "cleared";
        category?:
            | "wrong-agent"
            | "didnt-understand"
            | "bad-response"
            | "other";
        since?: string;
        until?: string;
        limit?: number;
        includeAllEntries?: boolean;
    };
};

// Export user feedback to a JSON or JSONL file.
export type ExportFeedbackAction = {
    actionName: "exportFeedback";
    parameters: {
        file: string;
        format?: "json" | "jsonl";
        includeAllEntries?: boolean;
    };
};

// Count total feedback entries and unique rated requests.
export type CountFeedbackAction = { actionName: "countFeedback" };
