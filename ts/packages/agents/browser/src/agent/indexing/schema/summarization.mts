// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Schema for page summarization output

export interface PageSummary {
    summary: string; // Concise summary of main content (1000 characters or less)
    keyPoints: string[]; // Main points or key information (max 5)
    entities: string[]; // Important entities mentioned (people, organizations, technologies)
    topics: string[]; // Main topics or themes
    contentType: string; // Type of content (e.g., 'article', 'documentation', 'news', 'reference', 'tutorial', 'blog', 'forum', 'other')
    intent: string; // Likely user intent for bookmarking (e.g., 'research', 'reference', 'learning', 'entertainment', 'shopping', 'work', 'news', 'other')
}
