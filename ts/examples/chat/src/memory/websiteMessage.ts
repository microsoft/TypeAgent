// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// This file now re-exports from the standalone website-memory package
// instead of using the local implementation

import * as website from "website-memory";

// Re-export types and functions from the website-memory package
export type WebsiteVisitInfo = website.WebsiteVisitInfo;
export const WebsiteMeta = website.WebsiteMeta;
export const Website = website.Website;
export const importWebsiteVisit = website.importWebsiteVisit;

// For compatibility with old code, also export as WebsiteMessage
export const WebsiteMessage = website.Website;

// Legacy compatibility - wrapper for the old WebsiteMessageSerializer
export class WebsiteMessageSerializer {
    public serialize(value: website.Website): string {
        return JSON.stringify(value);
    }

    public deserialize(json: string): website.Website {
        const data = JSON.parse(json);
        // Convert the data back to a Website object
        const visitInfo: website.WebsiteVisitInfo = {
            url: data.metadata.url,
            source: data.metadata.websiteSource,
            title: data.metadata.title,
            domain: data.metadata.domain,
            visitDate: data.metadata.visitDate,
            bookmarkDate: data.metadata.bookmarkDate,
            folder: data.metadata.folder,
            pageType: data.metadata.pageType,
            keywords: data.metadata.keywords,
            description: data.metadata.description,
            favicon: data.metadata.favicon,
            visitCount: data.metadata.visitCount,
            lastVisitTime: data.metadata.lastVisitTime,
            typedCount: data.metadata.typedCount,
        };

        return website.importWebsiteVisit(
            visitInfo,
            data.textChunks.join("\n"),
        );
    }
}
