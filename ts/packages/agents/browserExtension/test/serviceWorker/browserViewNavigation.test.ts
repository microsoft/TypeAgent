// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/// <reference path="../types/jest-chrome-extensions.d.ts" />

jest.mock("../../src/extension/serviceWorker/websocket", () => ({
    sendActionToAgent: jest.fn(),
}));

import { sendActionToAgent } from "../../src/extension/serviceWorker/websocket";
import {
    openBrowserView,
    resolveLocalBrowserViewUrl,
    getViewHostUrl,
} from "../../src/extension/serviceWorker/browserViewNavigation";

const lookupViewHost = () => getViewHostUrl(sendActionToAgent);

describe("Local browser view navigation", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(sendActionToAgent).mockResolvedValue({
            url: "http://localhost:49152",
        });
        chrome.tabs.query.mockResolvedValue([]);
    });

    test("resolves graph links without losing encoded names or fragments", async () => {
        await expect(
            resolveLocalBrowserViewUrl(
                "typeagent-browser://views/entityGraphView.html?entity=A%26B#detail",
                lookupViewHost,
            ),
        ).resolves.toBe(
            "http://localhost:49152/knowledge/entities/?entity=A%26B#detail",
        );
    });

    test("leaves external navigation alone without contacting the agent", async () => {
        await expect(
            resolveLocalBrowserViewUrl(
                "https://example.test/?q=hello",
                lookupViewHost,
            ),
        ).resolves.toBe("https://example.test/?q=hello");
        expect(sendActionToAgent).not.toHaveBeenCalled();
    });

    test("rejects unknown extension-specific routes", async () => {
        await expect(
            resolveLocalBrowserViewUrl(
                "typeagent-browser://views/options.html",
                lookupViewHost,
            ),
        ).rejects.toThrow(/Unknown browser view/);
        expect(sendActionToAgent).not.toHaveBeenCalled();
    });

    test("rediscovers the host after a view server restart", async () => {
        await openBrowserView("knowledgeLibrary", lookupViewHost);
        jest.mocked(sendActionToAgent).mockResolvedValue({
            url: "http://localhost:49153",
        });
        await openBrowserView("knowledgeLibrary", lookupViewHost);
        expect(chrome.tabs.create).toHaveBeenNthCalledWith(1, {
            url: "http://localhost:49152/knowledge/",
            active: true,
        });
        expect(chrome.tabs.create).toHaveBeenNthCalledWith(2, {
            url: "http://localhost:49153/knowledge/",
            active: true,
        });
    });

    test("does not open a port-zero view URL", async () => {
        jest.mocked(sendActionToAgent).mockResolvedValue({
            url: "http://localhost:0",
        });
        await expect(
            openBrowserView("memoryCenter", lookupViewHost),
        ).rejects.toThrow(/invalid or unavailable/);
        expect(chrome.tabs.create).not.toHaveBeenCalled();
    });
});
