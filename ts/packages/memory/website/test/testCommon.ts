// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createConversationSettings, createKnowledgeExtractor } from "knowpro";
import {
    createTestChatModel,
    createTestEmbeddingModel,
    NullEmbeddingModel,
} from "test-lib";
import { WebsiteCollection } from "../src/websiteCollection.js";
import {
    Website,
    WebsiteVisitInfo,
    importWebsiteVisit,
} from "../src/websiteMeta.js";
import fs from "fs";
import path from "path";

export type TestWebsiteInfo = {
    url: string;
    title: string;
    domain: string;
    source: "bookmark" | "history";
    pageType?: string;
    folder?: string;
    visitCount?: number;
    bookmarkDate?: string;
    visitDate?: string;
};

export function getTestBookmarks(): TestWebsiteInfo[] {
    return [
        {
            url: "https://github.com/microsoft/TypeAgent",
            title: "TypeAgent Repository",
            domain: "github.com",
            source: "bookmark",
            folder: "Development",
            pageType: "development",
            bookmarkDate: "2024-01-15T10:30:00.000Z",
        },
        {
            url: "https://docs.microsoft.com/typescript",
            title: "TypeScript Documentation",
            domain: "docs.microsoft.com",
            source: "bookmark",
            folder: "Development/Documentation",
            pageType: "documentation",
            bookmarkDate: "2024-01-10T14:20:00.000Z",
        },
        {
            url: "https://news.bbc.com/technology",
            title: "BBC Technology News",
            domain: "news.bbc.com",
            source: "bookmark",
            folder: "News",
            pageType: "news",
            bookmarkDate: "2024-01-05T09:15:00.000Z",
        },
    ];
}

export function getTestHistory(): TestWebsiteInfo[] {
    return [
        {
            url: "https://stackoverflow.com/questions/typescript",
            title: "TypeScript Questions - Stack Overflow",
            domain: "stackoverflow.com",
            source: "history",
            pageType: "development",
            visitDate: "2024-01-20T16:45:00.000Z",
            visitCount: 15,
        },
        {
            url: "https://www.reddit.com/r/programming",
            title: "Programming - Reddit",
            domain: "reddit.com",
            source: "history",
            pageType: "social",
            visitDate: "2024-01-19T11:30:00.000Z",
            visitCount: 8,
        },
        {
            url: "https://techcrunch.com/ai-news",
            title: "AI News - TechCrunch",
            domain: "techcrunch.com",
            source: "history",
            pageType: "news",
            visitDate: "2024-01-18T13:20:00.000Z",
            visitCount: 3,
        },
    ];
}

export function getAllTestWebsites(): TestWebsiteInfo[] {
    return [...getTestBookmarks(), ...getTestHistory()];
}

export function createOfflineWebsiteSettings() {
    return createConversationSettings(new NullEmbeddingModel(), 0);
}

export function createOnlineWebsiteSettings() {
    const [model, size] = createTestEmbeddingModel();
    const chatModel = createTestChatModel("website-memory");
    const settings = createConversationSettings(model, size);
    settings.semanticRefIndexSettings.knowledgeExtractor =
        createKnowledgeExtractor(chatModel);
    return settings;
}

export function createTestWebsiteCollection(
    websites: TestWebsiteInfo[],
    online: boolean = false,
): WebsiteCollection {
    const collection = new WebsiteCollection("test-collection");

    // Convert test data to Website objects
    const websiteObjects: Website[] = websites.map((info) => {
        const visitInfo: WebsiteVisitInfo = {
            url: info.url,
            title: info.title,
            domain: info.domain,
            source: info.source,
        };

        if (info.pageType) visitInfo.pageType = info.pageType;
        if (info.folder) visitInfo.folder = info.folder;
        if (info.visitCount) visitInfo.visitCount = info.visitCount;
        if (info.bookmarkDate) visitInfo.bookmarkDate = info.bookmarkDate;
        if (info.visitDate) visitInfo.visitDate = info.visitDate;

        return importWebsiteVisit(visitInfo);
    });

    collection.addWebsites(websiteObjects);

    // Update settings
    if (online) {
        Object.assign(collection.settings, createOnlineWebsiteSettings());
    } else {
        Object.assign(collection.settings, createOfflineWebsiteSettings());
    }

    return collection;
}

export async function loadTestWebsiteCollection(
    maxWebsites?: number,
    online: boolean = false,
): Promise<WebsiteCollection> {
    const testWebsites = getAllTestWebsites();
    const websites = maxWebsites
        ? testWebsites.slice(0, maxWebsites)
        : testWebsites;
    return createTestWebsiteCollection(websites, online);
}

export function createSampleChromeBookmarks() {
    return {
        roots: {
            bookmark_bar: {
                id: "1",
                name: "Bookmarks Bar",
                type: "folder" as const,
                children: [
                    {
                        id: "2",
                        name: "TypeAgent Repository",
                        type: "url" as const,
                        url: "https://github.com/microsoft/TypeAgent",
                        date_added: "13370728742000000", // Chrome microseconds
                    },
                    {
                        id: "3",
                        name: "Development",
                        type: "folder" as const,
                        children: [
                            {
                                id: "4",
                                name: "TypeScript Documentation",
                                type: "url" as const,
                                url: "https://docs.microsoft.com/typescript",
                                date_added: "13370728742000000",
                            },
                        ],
                    },
                ],
            },
            other: {
                id: "5",
                name: "Other Bookmarks",
                type: "folder" as const,
                children: [],
            },
            synced: {
                id: "6",
                name: "Mobile Bookmarks",
                type: "folder" as const,
                children: [],
            },
        },
    };
}

export function writeSampleBookmarksFile(filePath: string): void {
    const bookmarks = createSampleChromeBookmarks();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(bookmarks, null, 2));
}

export function cleanupTestFile(filePath: string): void {
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
}
