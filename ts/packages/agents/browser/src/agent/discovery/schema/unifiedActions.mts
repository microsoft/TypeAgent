// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Unified, de-duplicated list of user actions with structured components
export type UnifiedAction = {
    // The action verb (e.g., "buy", "book", "track", "search")
    verb: string;
    // The direct object of the action (e.g., "groceries", "flight", "package")
    directObject: string;
    // Human-readable short description (e.g., "user can buy groceries for delivery")
    shortDescription: string;
    // Confidence score for this action detection (0-1) 
    confidence: number;
    // Source of detection: "page_summary", "candidate_actions", or "unified"
    source: "page_summary" | "candidate_actions" | "unified";
};

export type UnifiedActionsList = {
    //  Array of unified, de-duplicated user actions
    actions: UnifiedAction[];
    // Total number of actions found before deduplication
    originalCount: number;
    // Number of actions after deduplication
    finalCount: number;
};
