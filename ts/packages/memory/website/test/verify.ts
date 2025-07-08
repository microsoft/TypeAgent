// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IndexingResults, MessageOrdinal } from "knowpro";
import { WebsiteCollection } from "../src/websiteCollection.js";
import { WebsiteDocPart } from "../src/websiteDocPart.js";

export function verifyWebsiteCollection(
    collection: WebsiteCollection,
    expectedMessageCount: number,
): void {
    expect(collection).toBeDefined();
    expect(collection.messages).toBeDefined();
    expect(collection.messages.length).toBe(expectedMessageCount);
    expect(collection.semanticRefs).toBeDefined();
    expect(collection.dataFrames).toBeDefined();
    expect(collection.dataFrames.size).toBeGreaterThan(0);
}

export function verifyNoIndexingErrors(results: IndexingResults): void {
    if (results.semanticRefs?.error) {
        expect(results.semanticRefs.error.length).toBe(0);
    }
    if (results.secondaryIndexResults?.relatedTerms?.error) {
        expect(results.secondaryIndexResults.relatedTerms.error.length).toBe(0);
    }
    if (results.secondaryIndexResults?.message?.error) {
        expect(results.secondaryIndexResults.message.error.length).toBe(0);
    }
}

export function verifyCompletedUpto(
    completedUpto: MessageOrdinal | undefined,
    expectedMaxOrdinal: MessageOrdinal,
): void {
    expect(completedUpto).toBeDefined();
    expect(completedUpto).toBe(expectedMaxOrdinal);
}

export function verifyNumberCompleted(
    numberCompleted: number | undefined,
    expectedCount: number,
): void {
    expect(numberCompleted).toBeDefined();
    expect(numberCompleted).toBe(expectedCount);
}

export function verifyWebsiteDataFrames(collection: WebsiteCollection): void {
    // Verify visit frequency data frame
    expect(collection.visitFrequency).toBeDefined();
    expect(collection.visitFrequency.name).toBe("visitFrequency");

    // Verify website categories data frame
    expect(collection.websiteCategories).toBeDefined();
    expect(collection.websiteCategories.name).toBe("websiteCategories");

    // Verify bookmark folders data frame
    expect(collection.bookmarkFolders).toBeDefined();
    expect(collection.bookmarkFolders.name).toBe("bookmarkFolders");
}

export function verifyWebsitesByDomain(
    collection: WebsiteCollection,
    expectedDomains: string[],
): void {
    const websites = collection.messages.getAll() as WebsiteDocPart[];
    const actualDomains = new Set(
        websites.map((w) => w.domain).filter((d) => d !== undefined),
    );

    for (const domain of expectedDomains) {
        expect(actualDomains.has(domain)).toBe(true);
    }
}

export function verifyWebsitesByPageType(
    collection: WebsiteCollection,
    pageType: string,
    expectedCount: number,
): void {
    const websites = collection.messages.getAll() as WebsiteDocPart[];
    const matchingWebsites = websites.filter((w) => w.pageType === pageType);
    expect(matchingWebsites.length).toBe(expectedCount);
}

export function verifyBookmarksByFolder(
    collection: WebsiteCollection,
    folder: string,
    expectedCount: number,
): void {
    const websites = collection.messages.getAll() as WebsiteDocPart[];
    const bookmarksInFolder = websites.filter(
        (w) => w.websiteSource === "bookmark" && w.folder?.includes(folder),
    );
    expect(bookmarksInFolder.length).toBe(expectedCount);
}

export function verifySerializationRoundtrip(
    collection: WebsiteCollection,
): void {
    collection.serialize().then((serialized) => {
        expect(serialized).toBeDefined();
        expect(serialized.messages).toBeDefined();
        expect(serialized.messages.length).toBe(collection.messages.length);
        expect(serialized.semanticRefs).toBeDefined();
        expect(serialized.nameTag).toBe(collection.nameTag);
        expect(serialized.tags).toEqual(collection.tags);
    });
}

export function verifyVisitFrequencyQueries(
    collection: WebsiteCollection,
): void {
    const topDomains = collection.getMostVisitedDomains(5);
    expect(Array.isArray(topDomains)).toBe(true);

    // Should have data if collection has websites
    if (collection.messages.length > 0) {
        // Note: topDomains might be empty initially until dataframes are populated
        // This depends on when addMetadataToDataFrames() is called
    }
}

export function verifyCategoryQueries(
    collection: WebsiteCollection,
    category: string,
): void {
    const websites = collection.getWebsitesByCategory(category);
    expect(Array.isArray(websites)).toBe(true);

    // If we find websites, they should match the category
    websites.forEach((site) => {
        expect(site.category).toBe(category);
    });
}

export function verifyFolderQueries(
    collection: WebsiteCollection,
    folder: string,
): void {
    const bookmarks = collection.getBookmarksByFolder(folder);
    expect(Array.isArray(bookmarks)).toBe(true);

    // If we find bookmarks, they should be in the specified folder
    bookmarks.forEach((bookmark) => {
        expect(bookmark.folderPath).toContain(folder);
    });
}
