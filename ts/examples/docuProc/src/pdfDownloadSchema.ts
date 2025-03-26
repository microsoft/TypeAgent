// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Schema defining how user queries are translated for arXiv PDF downloads.
export type PdfDownloadQuery = {
    // Natural language search query (e.g., "attention is all you need").
    searchTerm: string;

    /**
     * Field to perform search in:
     * - "title": Searches paper titles (default if unspecified).
     * - "author": Searches by authors' names.
     * - "all": Searches all fields (title, abstract, authors, etc.).
     */
    // default to "title" if not specified.
    searchField?: "title" | "author" | "all";

    // Pagination control (optional, defaults to 0).
    start?: number;

    // Max number of papers to return (optional, defaults to 3).
    maxResults?: number;

    // Criterion to sort results (optional, defaults to "relevance").
    sortBy?: "relevance" | "lastUpdatedDate" | "submittedDate";

    // Sort order (optional, defaults to "descending").
    sortOrder?: "ascending" | "descending";
};
