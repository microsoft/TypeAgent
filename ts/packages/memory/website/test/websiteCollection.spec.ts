// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describeIf, ensureOutputDir, hasTestKeys } from "test-lib";
import {
    getAllTestWebsites,
    getTestBookmarks,
    getTestHistory,
    loadTestWebsiteCollection,
    createTestWebsiteCollection,
} from "./testCommon.js";
import {
    verifyWebsiteCollection,
    verifyNoIndexingErrors,
    verifyCompletedUpto,
    verifyNumberCompleted,
    verifyWebsiteDataFrames,
    verifyWebsitesByDomain,
    verifyWebsitesByPageType,
    verifyBookmarksByFolder,
    verifySerializationRoundtrip,
} from "./verify.js";

describeIf(
    "websiteCollection.offline",
    () => hasTestKeys(),
    () => {
        test("create empty collection", () => {
            const collection = createTestWebsiteCollection([]);
            expect(collection).toBeDefined();
            expect(collection.nameTag).toBe("test-collection");
            expect(collection.messages.length).toBe(0);
            expect(collection.dataFrames).toBeDefined();
            expect(collection.dataFrames.size).toBe(6); // visitFrequency, websiteCategories, bookmarkFolders, knowledgeEntities, knowledgeTopics, actionKnowledgeCorrelations
        });

        test("create collection with bookmarks", () => {
            const bookmarks = getTestBookmarks();
            const collection = createTestWebsiteCollection(bookmarks);

            verifyWebsiteCollection(collection, bookmarks.length);
            verifyWebsiteDataFrames(collection);

            // Verify bookmark-specific data
            verifyBookmarksByFolder(collection, "Development", 2);
            verifyWebsitesByPageType(collection, "development", 1);
            verifyWebsitesByPageType(collection, "documentation", 1);
            verifyWebsitesByPageType(collection, "news", 1);
        });

        test("create collection with history", () => {
            const history = getTestHistory();
            const collection = createTestWebsiteCollection(history);

            verifyWebsiteCollection(collection, history.length);
            verifyWebsiteDataFrames(collection);

            // Verify history-specific data
            verifyWebsitesByPageType(collection, "development", 1);
            verifyWebsitesByPageType(collection, "social", 1);
            verifyWebsitesByPageType(collection, "news", 1);
        });

        test("create collection with mixed data", () => {
            const allWebsites = getAllTestWebsites();
            const collection = createTestWebsiteCollection(allWebsites);

            verifyWebsiteCollection(collection, allWebsites.length);
            verifyWebsiteDataFrames(collection);

            // Verify expected domains are present
            const expectedDomains = [
                "github.com",
                "docs.microsoft.com",
                "news.bbc.com",
                "stackoverflow.com",
                "reddit.com",
                "techcrunch.com",
            ];
            verifyWebsitesByDomain(collection, expectedDomains);
        });

        test("build index offline", async () => {
            const collection = await loadTestWebsiteCollection(4, false);
            const results = await collection.buildIndex();

            verifyNoIndexingErrors(results);

            const maxMessageOrdinal = collection.messages.length - 1;
            verifyCompletedUpto(
                // results.semanticRefs?.completedUpto,
                results.semanticRefs?.completedUpto?.messageOrdinal,
                maxMessageOrdinal,
            );
        });

        test("serialization", async () => {
            const collection = await loadTestWebsiteCollection(3, false);
            await collection.buildIndex();

            verifySerializationRoundtrip(collection);

            const serialized = await collection.serialize();
            expect(serialized.messages.length).toBe(3);
            expect(serialized.nameTag).toBe("test-collection");
        });

        test("dataframe operations", async () => {
            const collection = await loadTestWebsiteCollection(
                undefined,
                false,
            );
            await collection.buildIndex();

            // Test visit frequency queries
            const topDomains = collection.getMostVisitedDomains(3);
            expect(Array.isArray(topDomains)).toBe(true);

            // Test category queries
            const devWebsites = collection.getWebsitesByCategory("development");
            expect(Array.isArray(devWebsites)).toBe(true);

            // Test folder queries
            const devBookmarks = collection.getBookmarksByFolder("Development");
            expect(Array.isArray(devBookmarks)).toBe(true);
        });
    },
);

describeIf(
    "websiteCollection.online",
    () => hasTestKeys(),
    () => {
        const testTimeout = 10 * 60 * 1000;

        test(
            "build index online",
            async () => {
                const maxWebsites = 3;
                const collection = await loadTestWebsiteCollection(
                    maxWebsites,
                    true,
                );
                const results = await collection.buildIndex();

                verifyNoIndexingErrors(results);

                const maxMessageOrdinal = collection.messages.length - 1;
                verifyCompletedUpto(
                    // results.semanticRefs?.completedUpto,
                    results.semanticRefs?.completedUpto?.messageOrdinal,
                    maxMessageOrdinal,
                );

                verifyNumberCompleted(
                    results.secondaryIndexResults?.message?.numberCompleted,
                    collection.messages.length,
                );

                verifyWebsiteCollection(collection, maxWebsites);

                // Save to file for inspection
                const dirPath = await ensureOutputDir(
                    "test-results/websiteCollection",
                );
                await collection.writeToFile(dirPath, "testWebsites");
            },
            testTimeout,
        );

        test(
            "search and query operations",
            async () => {
                const collection = await loadTestWebsiteCollection(
                    undefined,
                    true,
                );
                await collection.buildIndex();

                // Test semantic search capabilities would go here
                // This would require implementing search methods in WebsiteCollection

                verifyWebsiteCollection(
                    collection,
                    getAllTestWebsites().length,
                );
                verifyWebsiteDataFrames(collection);
            },
            testTimeout,
        );
    },
);
