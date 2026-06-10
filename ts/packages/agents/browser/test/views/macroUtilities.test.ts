// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getAllWebFlows } from "../../src/extension/views/macroUtilities";

// Helper: configure the (already-mocked) chrome.runtime.sendMessage to invoke
// its callback with the supplied response. The real sendToServiceWorker helper
// in macroUtilities wraps this callback in a Promise.
function mockSendMessageResponse(response: unknown): void {
    (chrome.runtime.sendMessage as jest.Mock).mockImplementation(
        (_message: unknown, cb: (r: unknown) => void) => {
            cb(response);
        },
    );
}

describe("getAllWebFlows response parsing", () => {
    beforeEach(() => {
        (chrome.runtime.sendMessage as jest.Mock).mockReset();
    });

    it("returns the actions array on a normal success response", async () => {
        const macros = [
            { name: "buyProduct", description: "Buy a product" },
            { name: "addToCart", description: "Add to cart" },
        ];
        mockSendMessageResponse({ actions: macros });

        await expect(getAllWebFlows()).resolves.toEqual(macros);
    });

    it("returns an empty array when actions is empty", async () => {
        mockSendMessageResponse({ actions: [] });

        await expect(getAllWebFlows()).resolves.toEqual([]);
    });

    it("throws with the agent-supplied error on a {success:false} envelope", async () => {
        // This is the regression case: the service worker returns this envelope
        // when the agent RPC throws (e.g. "No connection to browser session.",
        // transport disconnect, bfcache port close). Previous behavior was to
        // pass the envelope through as if it were the macros array, causing
        // the caller's .forEach to crash and leave the loading spinner forever.
        mockSendMessageResponse({
            success: false,
            error: "No connection to browser session.",
        });

        await expect(getAllWebFlows()).rejects.toThrow(
            "No connection to browser session.",
        );
    });

    it("throws a generic message when an error envelope omits the error string", async () => {
        mockSendMessageResponse({ success: false });

        await expect(getAllWebFlows()).rejects.toThrow(
            "Failed to fetch macros",
        );
    });

    it("accepts a direct array response (legacy shape)", async () => {
        const macros = [{ name: "search" }];
        mockSendMessageResponse(macros);

        await expect(getAllWebFlows()).resolves.toEqual(macros);
    });

    it("throws on an unexpected response shape", async () => {
        mockSendMessageResponse({ foo: "bar" });

        await expect(getAllWebFlows()).rejects.toThrow(
            "Unexpected getAllWebFlows response",
        );
    });

    it("throws on a null response", async () => {
        mockSendMessageResponse(null);

        await expect(getAllWebFlows()).rejects.toThrow(
            "Unexpected getAllWebFlows response",
        );
    });
});
