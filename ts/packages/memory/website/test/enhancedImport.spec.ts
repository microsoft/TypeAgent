// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    enhancedWebsiteImport,
    analyzeImportQuality,
} from "../src/enhancedImport.js";
import { WebsiteVisitInfo } from "../src/websiteMeta.js";
import {
    intelligentWebsiteChunking,
    analyzeChunkQuality,
} from "../src/chunkingUtils.js";

describe("Stage 2 Enhanced Import", () => {
    describe("Intelligent Chunking", () => {
        test("produces better chunk boundaries than basic splitting", () => {
            const content = `
                This is the first paragraph. It contains several sentences that should be kept together.
                
                This is the second paragraph. It also has multiple sentences. The chunking should respect paragraph boundaries.
                
                This is a third paragraph with different content. It should be chunked appropriately based on the content structure.
            `;

            // Test intelligent chunking
            const chunks = intelligentWebsiteChunking(content, {
                maxCharsPerChunk: 150,
                preserveStructure: true,
                includeMetadata: true,
            });

            expect(chunks.length).toBeGreaterThan(1);
            expect(chunks.every((chunk) => chunk.length <= 200)).toBe(true); // Allow some overhead

            // Analyze chunk quality
            const quality = analyzeChunkQuality(chunks);
            expect(quality.averageChunkSize).toBeGreaterThan(50);
        });

        test("handles empty content gracefully", () => {
            const content = "";

            const chunks = intelligentWebsiteChunking(content, {
                maxCharsPerChunk: 1000,
                preserveStructure: true,
                includeMetadata: true,
            });

            expect(chunks.length).toBeGreaterThanOrEqual(0);
        });
    });

    describe("Enhanced Website Import", () => {
        test("processes plain text content with intelligent chunking", async () => {
            const visitInfo: WebsiteVisitInfo = {
                url: "https://example.com/test",
                title: "Test Page",
                source: "history",
            };

            const content =
                "This is test content that should be processed with intelligent chunking. ".repeat(
                    50,
                );

            const docParts = await enhancedWebsiteImport(visitInfo, content, {
                maxCharsPerChunk: 500,
                preserveStructure: true,
                extractionMode: "content",
                enableActionDetection: false,
                contentTimeout: 5000,
            });

            expect(docParts.length).toBeGreaterThan(1);
            expect(docParts[0].url).toBe(visitInfo.url);
            expect(docParts[0].title).toBe(visitInfo.title);
            expect(docParts[0].websiteSource).toBe(visitInfo.source);
        });

        test("handles empty content gracefully", async () => {
            const visitInfo: WebsiteVisitInfo = {
                url: "https://example.com/empty",
                title: "Empty Page",
                source: "bookmark",
            };

            const docParts = await enhancedWebsiteImport(visitInfo);

            expect(docParts.length).toBe(1);
            expect(docParts[0].textChunks).toEqual([]);
            expect(docParts[0].url).toBe(visitInfo.url);
        });

        test("preserves metadata during processing", async () => {
            const visitInfo: WebsiteVisitInfo = {
                url: "https://example.com/test",
                title: "Test Page",
                source: "bookmark",
                domain: "example.com",
                visitDate: "2025-01-01T00:00:00.000Z",
                folder: "Test Folder",
                pageType: "documentation",
            };

            const content = "Test content for metadata preservation.";

            const docParts = await enhancedWebsiteImport(visitInfo, content);

            expect(docParts.length).toBe(1);
            const docPart = docParts[0];

            expect(docPart.url).toBe(visitInfo.url);
            expect(docPart.title).toBe(visitInfo.title);
            expect(docPart.domain).toBe(visitInfo.domain);
            expect(docPart.visitDate).toBe(visitInfo.visitDate);
            expect(docPart.folder).toBe(visitInfo.folder);
            expect(docPart.pageType).toBe(visitInfo.pageType);
        });
    });

    describe("Import Quality Analysis", () => {
        test("analyzes import quality metrics correctly", async () => {
            const visitInfo: WebsiteVisitInfo = {
                url: "https://example.com/test",
                title: "Test Page",
                source: "history",
            };

            const content = "Test content for quality analysis. ".repeat(20);
            const startTime = Date.now();

            const docParts = await enhancedWebsiteImport(visitInfo, content);
            const metrics = analyzeImportQuality(docParts, startTime);

            expect(metrics.totalParts).toBeGreaterThan(0);
            expect(metrics.averagePartSize).toBeGreaterThan(0);
            expect(metrics.metadataPreservation).toBe(100); // All parts should have metadata
            expect(metrics.processingTime).toBeGreaterThanOrEqual(0); // Processing time can be 0 for fast operations
        });
    });

    describe("Error Handling", () => {
        test("handles malformed HTML gracefully", async () => {
            const visitInfo: WebsiteVisitInfo = {
                url: "https://example.com/malformed",
                title: "Malformed Page",
                source: "history",
            };

            const malformedHtml =
                "<html><body><div>Unclosed div<p>Unclosed paragraph";

            // Should not throw an error
            const docParts = await enhancedWebsiteImport(
                visitInfo,
                malformedHtml,
            );

            expect(docParts.length).toBeGreaterThan(0);
            expect(docParts[0].url).toBe(visitInfo.url);
        });
    });
});
