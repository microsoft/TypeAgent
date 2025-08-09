// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type WikipediaPageExternalLinks = {
    officialWebsite?: WebPageLink;
    //officialLinks?: WebPageLink[];
    //additionalLinks?: WebPageLink[];
    //images?: WebPageLink[];
};

export type WebPageLink = {
    url: string;
    title?: string;
};
