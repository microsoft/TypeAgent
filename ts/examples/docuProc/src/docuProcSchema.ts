// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface ArxivQuery {
    searchTerm: string;
    searchField?: "title" | "author" | "all";
    start?: number;
    maxResults?: number;
    sortBy?: "relevance" | "lastUpdatedDate" | "submittedDate";
    sortOrder?: "ascending" | "descending";
}
