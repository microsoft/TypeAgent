// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type WebsiteQueryType =
    | "temporal"
    | "frequency"
    | "category"
    | "general";

export type TemporalScope = "bookmark" | "visit" | "any";

export type FrequencyLevel = "high" | "medium" | "low";

export type WebsiteFacets = {
    bookmarkDate?: string;
    visitDate?: string;
    bookmarkYear?: number;
    visitYear?: number;
    visitCount?: number;
    visitFrequency?: FrequencyLevel;
    category?: string;
    source?: "bookmark" | "history";
    folder?: string;
    domain?: string;
    pageType?: string;
};

export type WebsiteAnswerResponse = {
    answer: string;
    results?: {
        url: string;
        title: string;
        facets: WebsiteFacets;
        relevanceNote?: string;
    }[];
    queryType: WebsiteQueryType;
    temporalPattern?: {
        type: "earliest" | "latest" | "when" | "year";
        scope?: TemporalScope;
        year?: number;
    };
    insights?: string[];
};
