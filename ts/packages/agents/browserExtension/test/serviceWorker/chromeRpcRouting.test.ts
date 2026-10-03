// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createChannelAdapter } from "@typeagent/agent-rpc/channel";
import {
    createChromeRpcServer,
    isTrustedRpcView,
} from "../../src/extension/serviceWorker/chromeRpcServer";
import { createChromeRpcClient } from "../../src/extension/views/chromeRpcClient";

jest.mock("@typeagent/agent-rpc/channel", () => ({
    createChannelAdapter: jest.fn(() => ({
        channel: {},
        notifyMessage: jest.fn(),
    })),
}));

jest.mock("@typeagent/agent-rpc/rpc", () => ({
    createRpc: jest.fn(() => ({})),
}));

describe("Chrome RPC routing", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        Object.defineProperty(chrome.runtime, "id", {
            value: "trusted-extension",
            configurable: true,
        });
        (chrome.runtime.getURL as jest.Mock).mockImplementation(
            (pathname: string) =>
                `chrome-extension://trusted-extension${pathname}`,
        );
    });

    test("routes packets only to their intended endpoint", () => {
        createChromeRpcServer({});
        createChromeRpcClient();

        const adapters = (createChannelAdapter as jest.Mock).mock.results.map(
            (result) => result.value,
        );
        const serverListener = (
            chrome.runtime.onMessage.addListener as jest.Mock
        ).mock.calls[0][0];
        const clientListener = (
            chrome.runtime.onMessage.addListener as jest.Mock
        ).mock.calls[1][0];
        const serverSend = (createChannelAdapter as jest.Mock).mock.calls[0][0];
        const clientSend = (createChannelAdapter as jest.Mock).mock.calls[1][0];

        serverSend({ method: "injectCommand" });
        clientSend({ method: "chatPanelProcessCommand" });

        expect(chrome.runtime.sendMessage).toHaveBeenNthCalledWith(1, {
            type: "rpc",
            target: "view",
            message: { method: "injectCommand" },
        });
        expect(chrome.runtime.sendMessage).toHaveBeenNthCalledWith(2, {
            type: "rpc",
            target: "serviceWorker",
            message: { method: "chatPanelProcessCommand" },
        });

        serverListener({ type: "rpc", target: "view", message: "wrong" });
        serverListener(
            { type: "rpc", target: "serviceWorker", message: "server" },
            {
                id: chrome.runtime.id,
                url: chrome.runtime.getURL("/views/pdfView.html"),
                origin: "chrome-extension://trusted-extension",
                frameId: 0,
            },
        );
        clientListener({
            type: "rpc",
            target: "serviceWorker",
            message: "wrong",
        });
        clientListener({ type: "rpc", target: "view", message: "client" });

        expect(adapters[0].notifyMessage).toHaveBeenCalledWith("server");
        expect(adapters[0].notifyMessage).toHaveBeenCalledTimes(1);
        expect(adapters[1].notifyMessage).toHaveBeenCalledWith("client");
        expect(adapters[1].notifyMessage).toHaveBeenCalledTimes(1);
    });

    test.each([
        undefined,
        {},
        { id: "forged-extension" },
        {
            id: "trusted-extension",
            url: "https://attacker.example/views/pdfView.html",
            origin: "https://attacker.example",
        },
        {
            id: "trusted-extension",
            url: "chrome-extension://trusted-extension/views/pdfView.html",
            origin: "https://attacker.example",
            frameId: 0,
        },
        {
            id: "trusted-extension",
            url: "chrome-extension://trusted-extension/views/pdfView.html",
            origin: "chrome-extension://trusted-extension",
            frameId: 2,
        },
        {
            id: "trusted-extension",
            url: "chrome-extension://trusted-extension/offscreen/offscreen.html",
            origin: "chrome-extension://trusted-extension",
        },
        {
            id: "trusted-extension",
            url: "chrome-extension://trusted-extension/views/pdfView.html",
        },
    ])("rejects unverified runtime sender %#", (sender) => {
        createChromeRpcServer({});
        const listener = (chrome.runtime.onMessage.addListener as jest.Mock)
            .mock.calls[0][0];
        listener(
            { type: "rpc", target: "serviceWorker", message: "pdfAuthorize" },
            sender,
        );
        expect(
            (createChannelAdapter as jest.Mock).mock.results[0].value
                .notifyMessage,
        ).not.toHaveBeenCalled();
    });

    test("accepts a top-level packaged Electron extension view", () => {
        expect(
            isTrustedRpcView({
                id: chrome.runtime.id,
                url: chrome.runtime.getURL("/views/memoryCenter.html?tab=pdf"),
                origin: "chrome-extension://trusted-extension",
                frameId: 0,
            }),
        ).toBe(true);
    });
});
