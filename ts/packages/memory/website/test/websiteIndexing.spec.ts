// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describeIf, ensureOutputDir, hasTestKeys } from "test-lib";
import fs from "fs";
import {
    createTestWebsiteCollection,
    loadTestWebsiteCollection,
    getAllTestWebsites,
    getTestBookmarks,
} from "./testCommon.js";
import {
    verifyWebsiteCollection,
    verifyNoIndexingErrors,
    verifyCompletedUpto,
    verifyNumberCompleted,
    verifyWebsiteDataFrames,
} from "./verify.js";

describeIf(
    "websiteIndexing.offline",
    () => hasTestKeys(),
    () => {
        test("basic indexing", async () => {
            const collection =
                createTestWebsiteCollection(getAllTestWebsites());
            const results = await collection.buildIndex();

            verifyNoIndexingErrors(results);
            verifyWebsiteCollection(collection, getAllTestWebsites().length);

            // Verify indexing completed for all messages
            const maxMessageOrdinal = collection.messages.length - 1;
            verifyCompletedUpto(
                // results.semanticRefs?.completedUpto,
                results.semanticRefs?.completedUpto?.messageOrdinal,
                maxMessageOrdinal,
            );
        });

        test("incremental indexing", async () => {
            const bookmarks = getTestBookmarks();
            const collection = createTestWebsiteCollection(bookmarks);

            // Initial indexing
            const initialResults = await collection.buildIndex();
            verifyNoIndexingErrors(initialResults);

            const initialMessageCount = collection.messages.length;

            // Add more websites
            const moreWebsites = [
                {
                    url: "https://example.com/new",
                    title: "New Website",
                    domain: "example.com",
                    source: "bookmark" as const,
                    folder: "Test",
                },
            ];

            const additionalWebsites =
                createTestWebsiteCollection(moreWebsites);
            collection.addWebsites(additionalWebsites.getWebsites());

            // Incremental indexing
            const incrementalResults = await collection.buildIndex();
            verifyNoIndexingErrors(incrementalResults);

            // Verify collection grew
            expect(collection.messages.length).toBe(initialMessageCount + 1);

            // Verify indexing completed for all messages including new ones
            const finalMaxOrdinal = collection.messages.length - 1;
            verifyCompletedUpto(
                // incrementalResults.semanticRefs?.completedUpto,
                incrementalResults.semanticRefs?.completedUpto?.messageOrdinal,
                finalMaxOrdinal,
            );
        });

        test("empty collection indexing", async () => {
            const collection = createTestWebsiteCollection([]);
            const results = await collection.buildIndex();

            verifyNoIndexingErrors(results);
            expect(collection.messages.length).toBe(0);
            expect(collection.semanticRefs.length).toBe(0);
        });

        test("dataframe population during indexing", async () => {
            const collection =
                createTestWebsiteCollection(getAllTestWebsites());

            // Before indexing - dataframes should be empty
            const emptyTopDomains = collection.getMostVisitedDomains(5);
            expect(emptyTopDomains.length).toBe(0);

            // After indexing - dataframes should be populated
            await collection.buildIndex();
            verifyWebsiteDataFrames(collection);

            // Note: Actual data population depends on addMetadataToDataFrames implementation
        });

        test("knowledge extraction from website metadata", async () => {
            const testWebsites = [
                {
                    url: "https://github.com/microsoft/TypeScript",
                    title: "TypeScript Programming Language",
                    domain: "github.com",
                    source: "bookmark" as const,
                    pageType: "development",
                    folder: "Programming Languages",
                },
            ];

            const collection = createTestWebsiteCollection(testWebsites);
            await collection.buildIndex();

            const website = collection.messages.getAll()[0];
            const knowledge = website.getKnowledge();

            expect(knowledge).toBeDefined();
            if (knowledge) {
                // Should extract domain as entity
                expect(
                    knowledge.entities.some((e) => e.name === "github.com"),
                ).toBe(true);

                // Should extract title as topic
                expect(knowledge.topics).toContain(
                    "TypeScript Programming Language",
                );

                // Should extract folder as topic
                expect(knowledge.topics).toContain("Programming Languages");

                // Should extract action
                expect(
                    knowledge.actions.some(
                        (a) =>
                            a.verbs.includes("bookmarked") &&
                            a.objectEntityName === "github.com",
                    ),
                ).toBe(true);
            }
        });

        test("serialization after indexing", async () => {
            const collection = await loadTestWebsiteCollection(3, false);
            await collection.buildIndex();

            const serialized = await collection.serialize();

            expect(serialized).toBeDefined();
            expect(serialized.messages.length).toBe(3);
            expect(serialized.semanticRefs.length).toBeGreaterThanOrEqual(0);
            expect(serialized.nameTag).toBe("test-collection");

            // Should have semantic index data if semantic refs were created
            if (serialized.semanticRefs.length > 0) {
                expect(serialized.semanticIndexData).toBeDefined();
            }
        });

        test("file persistence after indexing", async () => {
            const collection = await loadTestWebsiteCollection(2, false);
            await collection.buildIndex();

            const outputDir = await ensureOutputDir(
                "test-results/websiteIndexing",
            );
            await collection.writeToFile(outputDir, "persistenceTest");

            // Verify files were created
            const files = fs.readdirSync(outputDir);

            expect(
                files.some((f: string) => f.includes("persistenceTest")),
            ).toBe(true);
        });
    },
);

describeIf(
    "websiteIndexing.online",
    () => hasTestKeys(),
    () => {
        const testTimeout = 10 * 60 * 1000;

        test(
            "semantic indexing with knowledge extraction",
            async () => {
                const collection = await loadTestWebsiteCollection(3, true);
                const results = await collection.buildIndex();

                verifyNoIndexingErrors(results);
                verifyWebsiteCollection(collection, 3);

                // With online processing, should have semantic references
                expect(collection.semanticRefs.length).toBeGreaterThan(0);

                verifyNumberCompleted(
                    results.secondaryIndexResults?.message?.numberCompleted,
                    collection.messages.length,
                );

                const outputDir = await ensureOutputDir(
                    "test-results/websiteIndexing",
                );
                await collection.writeToFile(outputDir, "onlineSemanticIndex");
            },
            testTimeout,
        );

        test(
            "semantic search functionality",
            async () => {
                const collection = await loadTestWebsiteCollection(
                    undefined,
                    true,
                );
                await collection.buildIndex();

                // This would test semantic search capabilities
                // Implementation depends on adding search methods to WebsiteCollection

                verifyWebsiteCollection(
                    collection,
                    getAllTestWebsites().length,
                );
                expect(collection.semanticRefs.length).toBeGreaterThan(0);

                // Future: Test semantic queries like:
                // - "Find development websites"
                // - "Show me TypeScript resources"
                // - "What news sites do I visit?"
            },
            testTimeout,
        );

        test(
            "knowledge extraction with AI",
            async () => {
                const testWebsites = [
                    {
                        url: "https://openai.com/research",
                        title: "OpenAI Research - Artificial Intelligence",
                        domain: "openai.com",
                        source: "bookmark" as const,
                        pageType: "research",
                    },
                ];

                const collection = createTestWebsiteCollection(
                    testWebsites,
                    true,
                );
                await collection.buildIndex();

                expect(collection.semanticRefs.length).toBeGreaterThan(0);

                // The AI should extract meaningful knowledge about AI research
                const website = collection.messages.getAll()[0];
                const knowledge = website.getKnowledge();

                expect(knowledge).toBeDefined();
                if (knowledge) {
                    expect(knowledge.topics).toContain(
                        "OpenAI Research - Artificial Intelligence",
                    );
                    expect(
                        knowledge.entities.some((e) => e.name === "openai.com"),
                    ).toBe(true);
                }
            },
            testTimeout,
        );

        test(
            "large collection indexing performance",
            async () => {
                // Create a larger test collection
                const largeTestData = [];
                for (let i = 0; i < 20; i++) {
                    largeTestData.push({
                        url: `https://example${i}.com/page`,
                        title: `Test Page ${i}`,
                        domain: `example${i}.com`,
                        source: "history" as const,
                        visitCount: Math.floor(Math.random() * 20) + 1,
                    });
                }

                const collection = createTestWebsiteCollection(
                    largeTestData,
                    true,
                );

                const startTime = Date.now();
                const results = await collection.buildIndex();
                const endTime = Date.now();

                verifyNoIndexingErrors(results);
                verifyWebsiteCollection(collection, 20);

                // Performance should be reasonable (less than 5 minutes for 20 items)
                const indexingTime = endTime - startTime;
                expect(indexingTime).toBeLessThan(5 * 60 * 1000);

                console.log(`Indexed 20 websites in ${indexingTime}ms`);
            },
            testTimeout,
        );
    },
);
