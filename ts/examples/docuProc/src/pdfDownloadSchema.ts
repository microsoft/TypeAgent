// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// User request to download a PDF translated into a query for Arxiv.
export type PdfDownloadQuery = {
    searchTerm: string;
    searchField?: "title" | "author" | "all";
    start?: number;
    maxResults?: number;
    sortBy?: "relevance" | "lastUpdatedDate" | "submittedDate";
    sortOrder?: "ascending" | "descending";
};
