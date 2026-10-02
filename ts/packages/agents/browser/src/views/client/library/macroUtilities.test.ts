// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getAllWebFlows } from "./macroUtilities";

const fetchMock = jest.fn();
function mockViewResponse(data: unknown): void {
    fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data }),
    });
}

describe("getAllWebFlows response parsing", () => {
    beforeEach(() => {
        Object.assign(globalThis, { fetch: fetchMock });
        fetchMock.mockReset();
    });

    it("returns the actions array on a normal success response", async () => {
        const macros = [
            { name: "buyProduct", description: "Buy a product" },
            { name: "addToCart", description: "Add to cart" },
        ];
        mockViewResponse({ actions: macros });

        await expect(getAllWebFlows()).resolves.toEqual(macros);
    });

    it("returns an empty array when actions is empty", async () => {
        mockViewResponse({ actions: [] });

        await expect(getAllWebFlows()).resolves.toEqual([]);
    });

    it("throws with the agent-supplied error on a {success:false} envelope", async () => {
        mockViewResponse({
            success: false,
            error: "No connection to browser session.",
        });

        await expect(getAllWebFlows()).rejects.toThrow(
            "No connection to browser session.",
        );
    });

    it("throws a generic message when an error envelope omits the error string", async () => {
        mockViewResponse({ success: false });

        await expect(getAllWebFlows()).rejects.toThrow(
            "Failed to fetch macros",
        );
    });

    it("accepts a direct array response (legacy shape)", async () => {
        const macros = [{ name: "search" }];
        mockViewResponse(macros);

        await expect(getAllWebFlows()).resolves.toEqual(macros);
    });

    it("throws on an unexpected response shape", async () => {
        mockViewResponse({ foo: "bar" });

        await expect(getAllWebFlows()).rejects.toThrow(
            "Unexpected getAllWebFlows response",
        );
    });

    it("throws on a null response", async () => {
        mockViewResponse(null);

        await expect(getAllWebFlows()).rejects.toThrow(
            "Unexpected getAllWebFlows response",
        );
    });

    it("surfaces an HTTP gateway error rather than returning a broken list", async () => {
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 503,
            json: async () => ({
                success: false,
                error: "View agent disconnected",
            }),
        });
        await expect(getAllWebFlows()).rejects.toThrow(
            "View agent disconnected",
        );
    });
});
