// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { BrowserContentDownloader } from "../../src/extension/serviceWorker/contentDownloader";

describe("BrowserContentDownloader", () => {
    let downloader: BrowserContentDownloader;

    beforeEach(() => {
        downloader = new BrowserContentDownloader();
    });

    afterEach(async () => {
        await downloader.cleanup();
    });

    describe("getStatus", () => {
        it("should return correct status information", () => {
            const status = downloader.getStatus();

            expect(status).toBeDefined();
            expect(status.method).toBe("browser");
            expect(status.capabilities).toContain("authentication");
            expect(status.capabilities).toContain("javascript-execution");
            expect(status.capabilities).toContain("dynamic-content");
        });
    });

    describe("downloadContent fallback", () => {
        it("should gracefully handle browser unavailable and test fallback logic", async () => {
            // In test environment, browser APIs are not available
            // Test that the fallback logic is triggered correctly
            const testUrl = "https://httpbin.org/html";

            const result = await downloader.downloadContent(testUrl, {
                fallbackToFetch: true,
                timeout: 5000,
            });

            expect(result).toBeDefined();
            // In test environment, should fallback to fetch or fail gracefully
            if (result.success) {
                expect(result.method).toMatch(/^(browser|fetch)$/);
                expect(result.htmlContent).toBeDefined();
                expect(result.htmlContent!.length).toBeGreaterThan(0);
            } else {
                // If fetch also fails (network issues), ensure proper error handling
                expect(result.method).toBe("failed");
                expect(result.error).toBeDefined();
            }
        });

        it("should handle invalid URLs gracefully", async () => {
            const result = await downloader.downloadContent("invalid-url", {
                fallbackToFetch: true,
                timeout: 2000,
            });

            expect(result).toBeDefined();
            expect(result.success).toBe(false);
            expect(result.method).toBe("failed");
            expect(result.error).toBeDefined();
        });
    });

    describe("processHtmlContent", () => {
        it("should process HTML content with basic options", async () => {
            const testHtml = `
                <html>
                    <head><title>Test Page</title></head>
                    <body>
                        <h1>Test Heading</h1>
                        <p>Test paragraph content.</p>
                        <script>console.log('test');</script>
                    </body>
                </html>
            `;

            const result = await downloader.processHtmlContent(testHtml, {
                filterToReadingView: true,
                extractText: true,
                keepMetaTags: false,
            });

            expect(result).toBeDefined();
            expect(result.html).toBeDefined();
            expect(result.text).toBeDefined();
            expect(result.html).not.toContain("<script>");
            expect(result.text).toContain("Test Heading");
            expect(result.text).toContain("Test paragraph content");
        });
    });
});
