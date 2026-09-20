// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { sendActionToAgent } from "../../src/extension/serviceWorker/websocket";
import { handleSearchWebMemories } from "../../src/extension/serviceWorker/messageHandlers";

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
