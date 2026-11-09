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
            "http://localhost:49152/memory/hub/?entity=A%26B#/explore/web/entities/A%26B",
        );
    });

    test("leaves external navigation alone without contacting the agent", async () => {
        await expect(
            resolveLocalBrowserViewUrl(
                "https://example.test/?q=A%26B%20%2F%20C#detail%2Fpart",
                lookupViewHost,
            ),
        ).resolves.toBe(
            "https://example.test/?q=A%26B%20%2F%20C#detail%2Fpart",
        );
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

    test.each([
        ["memoryHub.html", "#detail%2Fpart%20one"],
        ["memoryCenter.html", "#/inbox"],
        ["knowledgeLibrary.html", "#/search"],
    ])(
        "resolves %s to the Hub without losing query state",
        async (page, hash) => {
            const suffix = "?q=A%26B%20%2F%20C#detail%2Fpart%20one";
            for (const prefix of [
                "typeagent-browser://views/",
                "typeagent-browser://",
            ]) {
                await expect(
                    resolveLocalBrowserViewUrl(
                        `${prefix}${page}${suffix}`,
                        lookupViewHost,
                    ),
                ).resolves.toBe(
                    `http://localhost:49152/memory/hub/?q=A%26B%20%2F%20C${hash}`,
                );
            }
        },
    );

    test("opens the hub without reusing legacy memory or knowledge tabs", async () => {
        await openBrowserView("memoryHub", lookupViewHost);
        expect(chrome.tabs.query).toHaveBeenCalledWith({
            url: [
                "http://localhost:49152/memory/hub/",
                "http://localhost:49152/library/memoryHub.html",
            ],
        });
        expect(chrome.tabs.create).toHaveBeenCalledWith({
            url: "http://localhost:49152/memory/hub/",
            active: true,
        });
    });

    test("rediscovers the host after a view server restart", async () => {
        await openBrowserView("memoryHub", lookupViewHost);
        jest.mocked(sendActionToAgent).mockResolvedValue({
            url: "http://localhost:49153",
        });

        await openBrowserView("memoryHub", lookupViewHost);
        expect(chrome.tabs.create).toHaveBeenNthCalledWith(1, {
            url: "http://localhost:49152/memory/hub/",
            active: true,
        });
        expect(chrome.tabs.create).toHaveBeenNthCalledWith(2, {
            url: "http://localhost:49153/memory/hub/",
            active: true,
        });
    });

    test("retired graph navigation reuses the Hub and updates its selected section without fragment-bearing tab patterns", async () => {
        chrome.tabs.query.mockResolvedValue([
            { id: 42, windowId: 7 },
        ] as chrome.tabs.Tab[]);
        await openBrowserView("entityGraph", lookupViewHost);
        expect(chrome.tabs.query).toHaveBeenCalledWith({
            url: [
                "http://localhost:49152/memory/hub/",
                "http://localhost:49152/library/memoryHub.html",
            ],
        });
        expect(chrome.tabs.update).toHaveBeenCalledWith(42, {
            active: true,
            url: "http://localhost:49152/memory/hub/#/explore/web/entities",
        });
        expect(chrome.tabs.create).not.toHaveBeenCalled();
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
