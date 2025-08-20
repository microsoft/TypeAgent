// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type SearchProvider = {
    name: string;
    url: string;
};

export const defaultSearchProviders: SearchProvider[] = [
    {
        name: "Bing",
        url: "https://www.bing.com/?q=%s",
    },
    {
        name: "Google",
        url: "https://www.google.com/search?q=%s",
    },
    {
        name: "Yahoo",
        url: "https://search.yahoo.com/search?p=%s",
    },
    {
        name: "DuckDuckGo",
        url: "https://duckduckgo.com/?q=%s",
    }
];
