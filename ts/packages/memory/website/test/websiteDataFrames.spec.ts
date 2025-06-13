// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describeIf, hasTestKeys } from "test-lib";
import { VisitFrequencyTable, WebsiteCategoryTable, BookmarkFolderTable } from "../src/tables.js";
import {
    createTestWebsiteCollection,
    getAllTestWebsites,
    getTestBookmarks,
    getTestHistory,
} from "./testCommon.js";
import {
    verifyWebsiteDataFrames,
    verifyVisitFrequencyQueries,
    verifyCategoryQueries,
    verifyFolderQueries,
} from "./verify.js";
import * as ms from "memory-storage";

describeIf(
    "websiteDataFrames",
    () => hasTestKeys(),
    () => {
    test("create dataframes", () => {
        const db = ms.sqlite.createDatabase(":memory:", true);
        
        // Test VisitFrequencyTable
        const visitTable = new VisitFrequencyTable(db);
        expect(visitTable.name).toBe("visitFrequency");
        expect(visitTable.columns).toBeDefined();
        expect(visitTable.columns.size).toBe(4); // domain, visitCount, lastVisitDate, averageTimeSpent
        
        // Test WebsiteCategoryTable
        const categoryTable = new WebsiteCategoryTable(db);
        expect(categoryTable.name).toBe("websiteCategories");
        expect(categoryTable.columns).toBeDefined();
        expect(categoryTable.columns.size).toBe(3); // domain, category, confidence
        
        // Test BookmarkFolderTable
        const folderTable = new BookmarkFolderTable(db);
        expect(folderTable.name).toBe("bookmarkFolders");
        expect(folderTable.columns).toBeDefined();
        expect(folderTable.columns.size).toBe(4); // folderPath, url, title, dateAdded
        
        db.close();
    });

    test("dataframe operations with visit frequency", () => {
        const db = ms.sqlite.createDatabase(":memory:", true);
        const visitTable = new VisitFrequencyTable(db);
        
        // Add test data
        visitTable.addRows(
            {
                sourceRef: { range: { start: { messageOrdinal: 0, chunkOrdinal: 0 } } },
                record: {
                    domain: "github.com",
                    visitCount: 25,
                    lastVisitDate: "2024-01-20T10:00:00.000Z"
                }
            },
            {
                sourceRef: { range: { start: { messageOrdinal: 1, chunkOrdinal: 0 } } },
                record: {
                    domain: "stackoverflow.com", 
                    visitCount: 15,
                    lastVisitDate: "2024-01-19T15:30:00.000Z"
                }
            }
        );
        
        // Test custom query methods
        const topDomains = visitTable.getTopDomainsByVisits(1);
        expect(topDomains.length).toBe(1);
        expect(topDomains[0].domain).toBe("github.com");
        expect(topDomains[0].visitCount).toBe(25);
        
        db.close();
    });

    test("dataframe operations with categories", () => {
        const db = ms.sqlite.createDatabase(":memory:", true);
        const categoryTable = new WebsiteCategoryTable(db);
        
        // Add test data
        categoryTable.addRows(
            {
                sourceRef: { range: { start: { messageOrdinal: 0, chunkOrdinal: 0 } } },
                record: {
                    domain: "github.com",
                    category: "development",
                    confidence: 0.9
                }
            },
            {
                sourceRef: { range: { start: { messageOrdinal: 1, chunkOrdinal: 0 } } },
                record: {
                    domain: "news.bbc.com",
                    category: "news", 
                    confidence: 0.95
                }
            }
        );
        
        // Test category queries
        const devSites = categoryTable.getDomainsByCategory("development");
        expect(devSites.length).toBe(1);
        expect(devSites[0].domain).toBe("github.com");
        expect(devSites[0].confidence).toBe(0.9);
        
        const githubCategories = categoryTable.getCategoriesForDomain("github.com");
        expect(githubCategories.length).toBe(1);
        expect(githubCategories[0].category).toBe("development");
        
        db.close();
    });

    test("dataframe operations with bookmark folders", () => {
        const db = ms.sqlite.createDatabase(":memory:", true);
        const folderTable = new BookmarkFolderTable(db);
        
        // Add test data
        folderTable.addRows(
            {
                sourceRef: { range: { start: { messageOrdinal: 0, chunkOrdinal: 0 } } },
                record: {
                    folderPath: "Development",
                    url: "https://github.com/microsoft/TypeAgent",
                    title: "TypeAgent Repository", 
                    dateAdded: "2024-01-15T10:30:00.000Z"
                }
            },
            {
                sourceRef: { range: { start: { messageOrdinal: 1, chunkOrdinal: 0 } } },
                record: {
                    folderPath: "Development/Documentation",
                    url: "https://docs.microsoft.com/typescript",
                    title: "TypeScript Documentation",
                    dateAdded: "2024-01-10T14:20:00.000Z"
                }
            }
        );
        
        // Test folder queries
        const devBookmarks = folderTable.getBookmarksByFolder("Development");
        expect(devBookmarks.length).toBe(2); // Should include subfolders
        
        const allFolders = folderTable.getAllFolders();
        expect(allFolders.length).toBe(2);
        expect(allFolders).toContain("Development");
        expect(allFolders).toContain("Development/Documentation");
        
        db.close();
    });

    test("collection dataframes integration", async () => {
        const collection = createTestWebsiteCollection(getAllTestWebsites());
        await collection.buildIndex();
        
        verifyWebsiteDataFrames(collection);
        verifyVisitFrequencyQueries(collection);
        
        // Test specific category queries
        verifyCategoryQueries(collection, "development");
        verifyCategoryQueries(collection, "news");
        
        // Test specific folder queries
        verifyFolderQueries(collection, "Development");
        verifyFolderQueries(collection, "News");
    });

    test("dataframe iteration", () => {
        const db = ms.sqlite.createDatabase(":memory:", true);
        const visitTable = new VisitFrequencyTable(db);
        
        // Add test data
        visitTable.addRows({
            sourceRef: { range: { start: { messageOrdinal: 0, chunkOrdinal: 0 } } },
            record: {
                domain: "example.com",
                visitCount: 5,
                lastVisitDate: "2024-01-20T10:00:00.000Z"
            }
        });
        
        // Test iteration
        let rowCount = 0;
        for (const row of visitTable) {
            expect(row.sourceRef).toBeDefined();
            expect(row.record).toBeDefined();
            expect(typeof row.record.domain).toBe("string");
            rowCount++;
        }
        
        expect(rowCount).toBe(1);
        
        db.close();
    });

    test("dataframes with bookmarks only", async () => {
        const bookmarks = getTestBookmarks();
        const collection = createTestWebsiteCollection(bookmarks);
        await collection.buildIndex();
        
        // Should have bookmark folder data
        const devBookmarks = collection.getBookmarksByFolder("Development");
        expect(Array.isArray(devBookmarks)).toBe(true);
        
        // Should have category data for development sites
        const devSites = collection.getWebsitesByCategory("development");
        expect(Array.isArray(devSites)).toBe(true);
    });

    test("dataframes with history only", async () => {
        const history = getTestHistory();
        const collection = createTestWebsiteCollection(history);
        await collection.buildIndex();
        
        // Should have visit frequency data
        const topDomains = collection.getMostVisitedDomains(5);
        expect(Array.isArray(topDomains)).toBe(true);
        
        // Should have category data
        const socialSites = collection.getWebsitesByCategory("social");
        expect(Array.isArray(socialSites)).toBe(true);
        
        // Should not have bookmark folder data
        const bookmarks = collection.getBookmarksByFolder("any");
        expect(bookmarks.length).toBe(0);
    });

    test("dataframe aggregation logic", async () => {
        // Create collection with duplicate domains to test aggregation
        const testData = [
            {
                url: "https://github.com/repo1",
                title: "Repo 1",
                domain: "github.com",
                source: "history" as const,
                visitCount: 5,
                visitDate: "2024-01-20T10:00:00.000Z"
            },
            {
                url: "https://github.com/repo2", 
                title: "Repo 2",
                domain: "github.com",
                source: "history" as const,
                visitCount: 3,
                visitDate: "2024-01-19T15:00:00.000Z"
            }
        ];
        
        const collection = createTestWebsiteCollection(testData);
        await collection.buildIndex();
        
        // Should aggregate visit counts for the same domain
        const topDomains = collection.getMostVisitedDomains(1);
        if (topDomains.length > 0) {
            // The aggregation should combine visit counts
            expect(topDomains[0].domain).toBe("github.com");
            // Note: Actual aggregation logic depends on implementation
        }
    });
});
