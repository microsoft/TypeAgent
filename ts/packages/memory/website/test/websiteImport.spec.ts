// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs";
import {
    importChromeBookmarks,
    importWebsites,
    getDefaultBrowserPaths,
} from "../src/importWebsites.js";
import {
    writeSampleBookmarksFile,
    cleanupTestFile,
    createSampleChromeBookmarks,
} from "./testCommon.js";
import path from "path";

describe("websiteImport", () => {
    const testDataDir = "./test/data";
    const testBookmarksFile = path.join(testDataDir, "test-bookmarks.json");

    beforeEach(() => {
        // Clean up any existing test files
        cleanupTestFile(testBookmarksFile);
    });

    afterEach(() => {
        // Clean up test files after each test
        cleanupTestFile(testBookmarksFile);
    });


    test("get default browser paths", () => {
        const paths = getDefaultBrowserPaths();

        expect(paths).toBeDefined();
        expect(paths.chrome).toBeDefined();
        expect(paths.edge).toBeDefined();

        expect(paths.chrome.bookmarks).toBeDefined();
        expect(paths.chrome.history).toBeDefined();
        expect(paths.edge.bookmarks).toBeDefined();
        expect(paths.edge.history).toBeDefined();

        // Paths should be platform-appropriate strings
        expect(typeof paths.chrome.bookmarks).toBe("string");
        expect(typeof paths.chrome.history).toBe("string");
    });

    test("import Chrome bookmarks from file", async () => {
        // Create test bookmarks file
        writeSampleBookmarksFile(testBookmarksFile);

        const websites = await importChromeBookmarks(testBookmarksFile);

        expect(Array.isArray(websites)).toBe(true);
        expect(websites.length).toBeGreaterThan(0);

        // Verify bookmark structure
        const bookmark = websites[0];
        expect(bookmark.url).toBeDefined();
        expect(bookmark.title).toBeDefined();
        expect(bookmark.domain).toBeDefined();
        expect(bookmark.source).toBe("bookmark");
        expect(bookmark.folder).toBeDefined();
    });

    test("import Chrome bookmarks with options", async () => {
        writeSampleBookmarksFile(testBookmarksFile);

        const websites = await importChromeBookmarks(testBookmarksFile, {
            limit: 1,
            folder: "Development",
        });

        expect(websites.length).toBeLessThanOrEqual(1);

        if (websites.length > 0) {
            expect(websites[0].folder).toContain("Development");
        }
    });

    test("import websites unified function", async () => {
        writeSampleBookmarksFile(testBookmarksFile);

        const websites = await importWebsites(
            "chrome",
            "bookmarks",
            testBookmarksFile,
            { limit: 5 },
        );

        expect(Array.isArray(websites)).toBe(true);
        expect(websites.length).toBeGreaterThan(0);
        expect(websites.length).toBeLessThanOrEqual(5);

        // Verify Website object structure
        const website = websites[0];
        expect(website.metadata).toBeDefined();
        expect(website.textChunks).toBeDefined();
        expect(website.metadata.url).toBeDefined();
        expect(website.metadata.websiteSource).toBe("bookmark");
    });

    test("import with progress callback", async () => {
        writeSampleBookmarksFile(testBookmarksFile);

        const progressUpdates: Array<{
            current: number;
            total: number;
            item: string;
        }> = [];

        const websites = await importWebsites(
            "chrome",
            "bookmarks",
            testBookmarksFile,
            { limit: 10 },
            (current, total, item) => {
                progressUpdates.push({ current, total, item });
            },
        );

        expect(websites.length).toBeGreaterThan(0);

        // Should have received progress updates
        if (websites.length > 1) {
            expect(progressUpdates.length).toBeGreaterThan(0);

            // Verify progress callback structure
            const update = progressUpdates[0];
            expect(typeof update.current).toBe("number");
            expect(typeof update.total).toBe("number");
            expect(typeof update.item).toBe("string");
        }
    });

    test("handle non-existent file", async () => {
        const nonExistentFile = "./test/data/non-existent.json";

        await expect(importChromeBookmarks(nonExistentFile)).rejects.toThrow();
    });

    test("handle invalid bookmark file", async () => {
        const invalidFile = path.join(testDataDir, "invalid-bookmarks.json");

        // Create invalid JSON file
        fs.writeFileSync(invalidFile, "{ invalid json");

        try {
            await expect(importChromeBookmarks(invalidFile)).rejects.toThrow();
        } finally {
            cleanupTestFile(invalidFile);
        }
    });

    test("sample bookmark structure", () => {
        const bookmarks = createSampleChromeBookmarks();

        expect(bookmarks.roots).toBeDefined();
        expect(bookmarks.roots.bookmark_bar).toBeDefined();
        expect(bookmarks.roots.other).toBeDefined();
        expect(bookmarks.roots.synced).toBeDefined();

        // Verify bookmark bar has test data
        const bookmarkBar = bookmarks.roots.bookmark_bar;
        expect(bookmarkBar.children).toBeDefined();
        expect(bookmarkBar.children!.length).toBeGreaterThan(0);

        // Find URL bookmark
        const urlBookmark = bookmarkBar.children!.find(
            (child) => child.type === "url",
        );
        expect(urlBookmark).toBeDefined();
        expect(urlBookmark!.url).toBeDefined();
        expect(urlBookmark!.name).toBeDefined();
    });
});

describe("websiteImport.integration", () => {
    test("end-to-end import and collection", async () => {
        const testBookmarksFile = "./test/data/integration-test-bookmarks.json";

        try {
            // Create test data
            writeSampleBookmarksFile(testBookmarksFile);

            // Import websites
            const websites = await importWebsites(
                "chrome",
                "bookmarks",
                testBookmarksFile,
            );

            expect(websites.length).toBeGreaterThan(0);

            // Verify each website has proper structure
            websites.forEach((website) => {
                expect(website.metadata.url).toBeDefined();
                expect(website.metadata.domain).toBeDefined();
                expect(website.metadata.websiteSource).toBe("bookmark");
                expect(website.textChunks).toBeDefined();
                expect(website.textChunks.length).toBeGreaterThan(0);

                // Verify text chunks include URL and title
                const firstChunk = website.textChunks[0];
                expect(firstChunk).toContain(website.metadata.url);
                if (website.metadata.title) {
                    expect(firstChunk).toContain(website.metadata.title);
                }
            });
        } finally {
            cleanupTestFile(testBookmarksFile);
        }
    });
});
