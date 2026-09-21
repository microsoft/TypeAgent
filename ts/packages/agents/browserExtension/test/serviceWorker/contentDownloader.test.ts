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

    describe("concurrent offscreen downloads", () => {
        it("creates one document and processes requests one at a time", async () => {
            const getContexts = jest.fn().mockResolvedValue([]);
            const createDocument = jest.fn().mockResolvedValue(undefined);
            const closeDocument = jest.fn().mockResolvedValue(undefined);
            let activeDownloads = 0;
            let maxActiveDownloads = 0;

            (chrome.runtime as any).getContexts = getContexts;
            (chrome as any).offscreen = {
                createDocument,
                closeDocument,
            };
            (chrome.runtime.sendMessage as jest.Mock).mockImplementation(
                async (message: any) => {
                    if (message.type === "ping") {
                        return {
                            success: true,
                            data: "pong",
                            messageId: message.messageId,
                        };
                    }
                    activeDownloads++;
                    maxActiveDownloads = Math.max(
                        maxActiveDownloads,
                        activeDownloads,
                    );
                    await Promise.resolve();
                    activeDownloads--;
                    return {
                        success: true,
                        messageId: message.messageId,
                        data: {
                            processedHtml: `<p>${message.url}</p>`,
                            textContent: message.url,
                            metadata: { finalUrl: message.url },
                        },
                    };
                },
            );
            (downloader as any).delay = jest.fn().mockResolvedValue(undefined);

            const results = await Promise.all(
                Array.from({ length: 10 }, (_, index) =>
                    downloader.downloadContent(`https://example.test/${index}`),
                ),
            );

            expect(results.every((result) => result.success)).toBe(true);
            expect(createDocument).toHaveBeenCalledTimes(1);
            expect(getContexts).toHaveBeenCalledTimes(1);
            expect(maxActiveDownloads).toBe(1);
        });

        it("cancels a timed-out request before processing the next item", async () => {
            (chrome.runtime as any).getContexts = jest
                .fn()
                .mockResolvedValue([{ contextType: "OFFSCREEN_DOCUMENT" }]);
            (chrome as any).offscreen = {
                closeDocument: jest.fn().mockResolvedValue(undefined),
            };
            (downloader as any).maxRetries = 1;
            (downloader as any).sanitizeTimeout = () => 1;

            let firstMessageId: string | undefined;
            (chrome.runtime.sendMessage as jest.Mock).mockImplementation(
                (message: any) => {
                    if (message.type === "ping") {
                        return Promise.resolve({
                            success: true,
                            data: "pong",
                            messageId: message.messageId,
                        });
                    }
                    if (message.type === "cancel") {
                        expect(message.targetMessageId).toBe(firstMessageId);
                        return Promise.resolve({
                            success: true,
                            data: { cancelled: true },
                            messageId: message.messageId,
                        });
                    }
                    if (firstMessageId === undefined) {
                        firstMessageId = message.messageId;
                        return new Promise(() => {});
                    }
                    return Promise.resolve({
                        success: true,
                        messageId: message.messageId,
                        data: {
                            processedHtml: "<p>second</p>",
                            textContent: "second",
                            metadata: { finalUrl: message.url },
                        },
                    });
                },
            );

            const first = await downloader.downloadContent(
                "https://example.test/slow",
                { timeout: 1 },
            );
            const second = await downloader.downloadContent(
                "https://example.test/next",
                { timeout: 1 },
            );

            expect(first).toMatchObject({ success: false, method: "failed" });
            expect(second).toMatchObject({
                success: true,
                textContent: "second",
            });
            expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: "cancel",
                    targetMessageId: firstMessageId,
                }),
            );
        });
    });

    describe("retry classification", () => {
        beforeEach(() => {
            (chrome.runtime as any).getContexts = jest
                .fn()
                .mockResolvedValue([{ contextType: "OFFSCREEN_DOCUMENT" }]);
            (chrome as any).offscreen = {
                closeDocument: jest.fn().mockResolvedValue(undefined),
            };
            (downloader as any).delay = jest.fn().mockResolvedValue(undefined);
        });

        it("does not retry permanent HTTP failures", async () => {
            let downloadAttempts = 0;
            (chrome.runtime.sendMessage as jest.Mock).mockImplementation(
                async (message: any) => {
                    if (message.type === "ping") {
                        return {
                            success: true,
                            data: "pong",
                            messageId: message.messageId,
                        };
                    }
                    downloadAttempts++;
                    return {
                        success: false,
                        error: "HTTP 404: Not Found",
                        messageId: message.messageId,
                    };
                },
            );

            const result = await downloader.downloadContent(
                "https://example.test/missing",
            );

            expect(result.success).toBe(false);
            expect(downloadAttempts).toBe(1);
        });

        it("retries transient HTTP failures", async () => {
            let downloadAttempts = 0;
            (chrome.runtime.sendMessage as jest.Mock).mockImplementation(
                async (message: any) => {
                    if (message.type === "ping") {
                        return {
                            success: true,
                            data: "pong",
                            messageId: message.messageId,
                        };
                    }
                    downloadAttempts++;
                    return downloadAttempts === 1
                        ? {
                              success: false,
                              error: "HTTP 503: Service Unavailable",
                              messageId: message.messageId,
                          }
                        : {
                              success: true,
                              messageId: message.messageId,
                              data: {
                                  processedHtml: "<p>recovered</p>",
                                  textContent: "recovered",
                                  metadata: { finalUrl: message.url },
                              },
                          };
                },
            );

            const result = await downloader.downloadContent(
                "https://example.test/retry",
            );

            expect(result.success).toBe(true);
            expect(downloadAttempts).toBe(2);
        });
    });
});
