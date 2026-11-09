// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { awaitDocumentPageLoad } from "../../src/extension/serviceWorker/pageLoad";

describe("document-bound passive page load", () => {
    const getFrame = jest.fn();
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        Object.defineProperty(chrome.webNavigation, "getFrame", {
            configurable: true,
            value: getFrame,
        });
        getFrame.mockResolvedValue({ documentId: "document-1" });
        chrome.tabs.get.mockResolvedValue({ status: "complete" });
        chrome.tabs.sendMessage.mockResolvedValue("true");
    });
    afterEach(() => jest.useRealTimers());

    test("routes the stability check to the exact main document", async () => {
        await expect(awaitDocumentPageLoad(7, 2000)).resolves.toBe("true");
        expect(getFrame).toHaveBeenCalledWith({ tabId: 7, frameId: 0 });
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
            7,
            { type: "await_page_incremental_load", timeout: 2000 },
            { documentId: "document-1" },
        );
        expect(jest.getTimerCount()).toBe(0);
    });

    test("uses the default stability budget when omitted", async () => {
        await expect(awaitDocumentPageLoad(7)).resolves.toBe("true");
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
            7,
            { type: "await_page_incremental_load", timeout: 5000 },
            { documentId: "document-1" },
        );
    });

    test("retries only the passive read when navigation closes its document", async () => {
        chrome.tabs.sendMessage
            .mockRejectedValueOnce(
                new Error(
                    "The message port closed before a response was received.",
                ),
            )
            .mockResolvedValueOnce("true");
        getFrame
            .mockResolvedValueOnce({ documentId: "document-1" })
            .mockResolvedValue({ documentId: "document-2" });
        const result = awaitDocumentPageLoad(7);
        await jest.advanceTimersByTimeAsync(100);
        await expect(result).resolves.toBe("true");
        expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
        expect(chrome.tabs.sendMessage.mock.calls[1][2]).toEqual({
            documentId: "document-2",
        });
    });

    test("does not accept a stability response from a replaced document", async () => {
        getFrame
            .mockResolvedValueOnce({ documentId: "document-1" })
            .mockResolvedValue({ documentId: "document-2" });
        await expect(awaitDocumentPageLoad(7)).resolves.toBe("true");
        expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
    });

    test("bounds an unanswered request instead of leaving an RPC pending forever", async () => {
        chrome.tabs.sendMessage.mockImplementation(() => new Promise(() => {}));
        const result = expect(awaitDocumentPageLoad(7, 1000)).rejects.toThrow(
            "timed out",
        );
        await jest.advanceTimersByTimeAsync(1000);
        await result;
        expect(jest.getTimerCount()).toBe(0);
    });

    test("propagates unrelated errors rather than hiding them as navigation", async () => {
        chrome.tabs.sendMessage.mockRejectedValue(
            new Error("Permission denied"),
        );
        await expect(awaitDocumentPageLoad(7)).rejects.toThrow(
            "Permission denied",
        );
        expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
    });

    test("waits for document completion before contacting a not-yet-installed stability listener", async () => {
        chrome.tabs.get
            .mockResolvedValueOnce({
                status: "loading",
                pendingUrl: "https://shop.example/next",
            })
            .mockResolvedValueOnce({
                status: "loading",
                pendingUrl: "https://shop.example/next",
            })
            .mockResolvedValue({ status: "complete" });
        const result = awaitDocumentPageLoad(7);
        await jest.advanceTimersByTimeAsync(150);
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(50);
        await expect(result).resolves.toBe("true");
        expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
    });

    test("does not accept old-document stability when a new navigation starts", async () => {
        chrome.tabs.get
            .mockResolvedValueOnce({ status: "complete" })
            .mockResolvedValueOnce({
                status: "loading",
                pendingUrl: "https://shop.example/next",
            })
            .mockResolvedValue({ status: "complete" });
        const result = awaitDocumentPageLoad(7);
        await jest.advanceTimersByTimeAsync(100);
        await expect(result).resolves.toBe("true");
        expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
    });

    test("bounds document-loading polling without sending into an unfinished document", async () => {
        chrome.tabs.get.mockResolvedValue({
            status: "loading",
            pendingUrl: "https://shop.example/next",
        });
        const result = expect(awaitDocumentPageLoad(7, 1000)).rejects.toThrow(
            "timed out",
        );
        await jest.advanceTimersByTimeAsync(1000);
        await result;
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
        expect(jest.getTimerCount()).toBe(0);
    });

    test("surfaces document errors and rejects malformed replies instead of pretending readiness", async () => {
        chrome.tabs.sendMessage.mockResolvedValue({ error: "Detector failed" });
        await expect(awaitDocumentPageLoad(7)).rejects.toThrow(
            "Detector failed",
        );
        chrome.tabs.sendMessage.mockResolvedValue(undefined);
        await expect(awaitDocumentPageLoad(7)).rejects.toThrow(
            "invalid document response",
        );
    });

    test("retries an absent DOMContentLoaded listener during main-document loading", async () => {
        chrome.tabs.get.mockResolvedValue({ status: "loading" });
        chrome.tabs.sendMessage
            .mockResolvedValueOnce(undefined)
            .mockResolvedValue("true");
        const result = awaitDocumentPageLoad(7);
        await jest.advanceTimersByTimeAsync(100);
        await expect(result).resolves.toBe("true");
        expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
    });

    test("accepts main-document stability without waiting for unrelated frame resources", async () => {
        chrome.tabs.get.mockResolvedValue({ status: "loading" });
        await expect(awaitDocumentPageLoad(7)).resolves.toBe("true");
        expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
    });

    test.each([0, -1, NaN, Infinity])(
        "rejects invalid timeout %s",
        async (timeout) => {
            await expect(awaitDocumentPageLoad(7, timeout)).rejects.toThrow(
                "positive finite",
            );
            expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
        },
    );
});
