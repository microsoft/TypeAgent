// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createChannelAdapter } from "@typeagent/agent-rpc/channel";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import type { BrowserControlInvokeFunctions } from "@typeagent/browser-control-rpc/types";
import { createExternalBrowserServer } from "../../src/extension/serviceWorker/externalBrowserControlServer";

jest.mock("@typeagent/agent-rpc/channel", () => ({
    createChannelAdapter: jest.fn(() => ({
        channel: {},
        notifyMessage: jest.fn(),
        notifyDisconnected: jest.fn(),
    })),
}));
jest.mock("@typeagent/agent-rpc/rpc", () => ({
    createRpc: jest.fn(() => ({})),
}));
jest.mock("@typeagent/browser-control-rpc/contentScriptRpc/client", () => ({
    createContentScriptRpcClient: jest.fn(() => ({
        getPageLinksByQuery: jest.fn(),
        capturePageSnapshot: jest.fn().mockResolvedValue({
            url: "https://example.com",
            title: "Article",
            htmlFragments: [{ frameId: "0", content: "<h1>Article</h1>" }],
            warnings: [],
        }),
    })),
}));
jest.mock("../../src/extension/serviceWorker/tabManager", () => ({
    getActiveTab: jest
        .fn()
        .mockResolvedValue({ id: 7, url: "https://example.com" }),
}));
jest.mock("../../src/extension/serviceWorker/ui", () => ({}));
jest.mock("../../src/extension/serviceWorker/capture", () => ({}));
jest.mock(
    "../../src/extension/serviceWorker/screenshotCoordinator",
    () => ({}),
);
jest.mock("../../src/extension/serviceWorker/browserActions", () => ({}));

test("capture RPC is document-targeted and cannot consume active RPC or another document's replies", async () => {
    jest.clearAllMocks();
    Object.defineProperty(crypto, "randomUUID", {
        configurable: true,
        value: () => "opaque",
    });
    const tab = {
        id: 7,
        url: "https://example.com",
        incognito: false,
        status: "complete",
    };
    (chrome.tabs.query as jest.Mock).mockResolvedValue([tab]);
    (chrome.tabs.get as jest.Mock).mockResolvedValue(tab);
    (chrome.scripting.executeScript as jest.Mock).mockResolvedValue([
        {
            frameId: 0,
            documentId: "listed-document",
            result: { url: tab.url, title: "Article" },
        },
    ]);
    (chrome.tabs.sendMessage as jest.Mock).mockResolvedValue({
        captureRpcAccepted: true,
    });
    createExternalBrowserServer({}, async () => "http://localhost:1234");
    const handlers = (createRpc as jest.Mock).mock
        .calls[0][2] as BrowserControlInvokeFunctions;
    await handlers.followLinkByText("Article");
    const [selected] = await handlers.getCapturePages();
    await handlers.capturePageSnapshot(selected.pageId);

    const adapters = (createChannelAdapter as jest.Mock).mock.results.map(
        (result) => result.value,
    );
    const captureSend = (createChannelAdapter as jest.Mock).mock.calls[1][0];
    await captureSend({ type: "invoke", callId: 0 });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        7,
        { type: "captureRpc", message: { type: "invoke", callId: 0 } },
        { documentId: "listed-document" },
    );
    const listener = (chrome.runtime.onMessage.addListener as jest.Mock).mock
        .calls[0][0];
    const sender = { tab, frameId: 0, documentId: "listed-document" };
    listener({ type: "rpc", message: "active reply" }, sender);
    listener(
        { type: "captureRpc", message: "wrong document" },
        { ...sender, documentId: "replacement" },
    );
    listener(
        { type: "captureRpc", message: "wrong frame" },
        { ...sender, frameId: 1 },
    );
    listener({ type: "captureRpc", message: "capture reply" }, sender);
    expect(adapters[0].notifyMessage).toHaveBeenCalledTimes(1);
    expect(adapters[0].notifyMessage).toHaveBeenCalledWith("active reply");
    expect(adapters[1].notifyMessage).toHaveBeenCalledTimes(1);
    expect(adapters[1].notifyMessage).toHaveBeenCalledWith("capture reply");
    (chrome.tabs.sendMessage as jest.Mock).mockResolvedValue(undefined);
    const callback = jest.fn();
    await captureSend({ type: "invoke", callId: 1 }, callback);
    expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
            message: "Explicit-page capture is unavailable in this document.",
        }),
    );
});
