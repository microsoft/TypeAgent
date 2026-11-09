// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getTabHTMLFragments } from "../../src/extension/serviceWorker/capture";
import { sendActionToAgent } from "../../src/extension/serviceWorker/websocket";
import { indexPageContent } from "../../src/extension/serviceWorker/messageHandlers";

jest.mock("../../src/extension/serviceWorker/capture", () => ({
    CompressionMode: { KnowledgeExtraction: "knowledgeExtraction" },
    getTabHTMLFragments: jest.fn(),
}));
jest.mock("../../src/extension/serviceWorker/websocket", () => ({
    sendActionToAgent: jest.fn(),
}));
jest.mock(
    "../../src/extension/serviceWorker/contentDownloader.js",
    () => ({ BrowserContentDownloader: jest.fn() }),
    { virtual: true },
);

const capture = getTabHTMLFragments as jest.MockedFunction<
    typeof getTabHTMLFragments
>;
const send = sendActionToAgent as jest.MockedFunction<typeof sendActionToAgent>;
const tab = { id: 23, url: "https://example.test/how-to", title: "How to" };

describe("indexPageContent", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        capture.mockResolvedValue([
            {
                frameId: 0,
                content: "<h2>Steps</h2><ol><li>First</li><li>Second</li></ol>",
                text: "",
            },
        ]);
    });

    it("captures the specified tab once and forwards the status request", async () => {
        send.mockResolvedValue({
            indexed: true,
            warnings: [],
            howTo: { enabled: true, candidateCount: 1 },
        });
        const result = await indexPageContent(tab, false, {
            reportHowToStatus: true,
        });
        expect(capture).toHaveBeenCalledWith(
            tab,
            "knowledgeExtraction",
            false,
            true,
            false,
            true,
            true,
        );
        expect(send).toHaveBeenCalledWith({
            actionName: "indexWebPageContent",
            parameters: expect.objectContaining({
                url: tab.url,
                title: tab.title,
                htmlFragments: expect.any(Array),
                reportHowToStatus: true,
                activityType: "captured",
                mode: "content",
            }),
        });
        expect(result.howTo?.candidateCount).toBe(1);
        expect(send.mock.calls[0][0].parameters).not.toHaveProperty("quality");
    });

    it.each(["basic", "summary", "full"])(
        "rejects obsolete indexing mode %s before capture",
        async (mode) => {
            const result = await indexPageContent(tab, false, {
                mode: mode as "content",
            });
            expect(result.indexed).toBe(false);
            expect(result.error).toContain("Only 'content' is supported");
            expect(capture).not.toHaveBeenCalled();
            expect(send).not.toHaveBeenCalled();
        },
    );

    it("reports a resolved indexing failure instead of showing success", async () => {
        send.mockResolvedValue({ indexed: false, error: "Unavailable" });
        const result = await indexPageContent(tab);
        expect(result).toEqual({ indexed: false, error: "Unavailable" });
        expect(chrome.action.setBadgeText).toHaveBeenCalledWith({
            text: "✗",
            tabId: tab.id,
        });
    });

    it("reports a rejected transport call", async () => {
        send.mockRejectedValue(new Error("Disconnected"));
        expect(await indexPageContent(tab, false)).toEqual({
            indexed: false,
            error: "Disconnected",
        });
    });
});
