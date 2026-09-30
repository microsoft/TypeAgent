// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { sendActionToAgent } from "../../src/extension/serviceWorker/websocket";
import {
    handleImportWebsiteDataWithProgress,
    handleSearchWebMemories,
} from "../../src/extension/serviceWorker/messageHandlers";
import { broadcastEvent } from "../../src/extension/serviceWorker/extensionEventHelpers";

jest.mock("../../src/extension/serviceWorker/websocket", () => ({
    sendActionToAgent: jest.fn(async () => ({
        websites: [],
        summary: { searchTime: 1 },
    })),
}));
jest.mock("../../src/extension/serviceWorker/capture", () => ({}));
jest.mock(
    "../../src/extension/serviceWorker/contentDownloader.js",
    () => ({
        BrowserContentDownloader: jest.fn(),
    }),
    { virtual: true },
);
jest.mock("../../src/extension/serviceWorker/extensionEventHelpers", () => ({
    broadcastEvent: jest.fn(),
}));

describe("handleSearchWebMemories", () => {
    test("forwards structured filters to the browser agent", async () => {
        await handleSearchWebMemories({
            parameters: {
                query: "design",
                limit: 50,
                minScore: 0.4,
                domain: "example.test",
                source: "bookmark",
                dateFrom: "2026-01-01T00:00:00.000Z",
                dateTo: "2026-03-01T00:00:00.000Z",
            },
        });

        expect(sendActionToAgent).toHaveBeenCalledWith({
            actionName: "searchWebMemories",
            parameters: expect.objectContaining({
                query: "design",
                limit: 50,
                minScore: 0.4,
                domain: "example.test",
                source: "bookmark",
                dateFrom: "2026-01-01T00:00:00.000Z",
                dateTo: "2026-03-01T00:00:00.000Z",
            }),
        });
    });
});

describe("handleImportWebsiteDataWithProgress", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("forwards the nested import id and known total", async () => {
        (sendActionToAgent as jest.Mock).mockResolvedValueOnce({
            success: true,
            itemCount: 10,
        });

        const result = await handleImportWebsiteDataWithProgress({
            type: "importWebsiteDataWithProgress",
            parameters: {
                source: "chrome",
                type: "bookmarks",
                limit: 10,
                importId: "import-10",
                totalItems: 10,
                progressCallback: true,
            },
        });

        expect(broadcastEvent).toHaveBeenCalledWith("importProgress", {
            importId: "import-10",
            progress: expect.objectContaining({
                importId: "import-10",
                phase: "initializing",
                totalItems: 10,
                processedItems: 0,
            }),
        });
        expect(sendActionToAgent).toHaveBeenCalledWith({
            actionName: "importWebsiteDataWithProgress",
            parameters: expect.objectContaining({
                importId: "import-10",
                totalItems: 10,
            }),
        });
        expect(broadcastEvent).toHaveBeenCalledTimes(1);
        expect(result).toEqual({
            success: true,
            itemCount: 10,
            error: undefined,
        });
    });

    test("reports an agent-declared failure as terminal error progress", async () => {
        (sendActionToAgent as jest.Mock).mockResolvedValueOnce({
            success: false,
            itemCount: 3,
            error: "durable ingestion failed",
        });

        const result = await handleImportWebsiteDataWithProgress({
            type: "importWebsiteDataWithProgress",
            parameters: {
                source: "chrome",
                type: "bookmarks",
                limit: 10,
                importId: "import-failed",
                totalItems: 10,
            },
        });

        expect(broadcastEvent).toHaveBeenLastCalledWith("importProgress", {
            importId: "import-failed",
            progress: expect.objectContaining({
                phase: "error",
                totalItems: 10,
                processedItems: 3,
                errors: [
                    expect.objectContaining({
                        message: "durable ingestion failed",
                    }),
                ],
            }),
        });
        expect(result.success).toBe(false);
    });
});
