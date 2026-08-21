// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getHttpTransportOptions } from "../src/mcp/mcpConnection.js";

describe("HTTP MCP transport options", () => {
    it("passes resolved headers and installs a per-request timeout fetch", () => {
        const options = getHttpTransportOptions({
            kind: "http",
            url: "https://example.com/mcp",
            headers: {
                Authorization: "Bearer secret",
                "X-Literal": "literal",
            },
            timeoutMs: 2500,
        });

        expect(options?.requestInit?.headers).toEqual({
            Authorization: "Bearer secret",
            "X-Literal": "literal",
        });
        expect(options?.fetch).toEqual(expect.any(Function));
    });

    it("does not allocate transport options when none are configured", () => {
        expect(
            getHttpTransportOptions({
                kind: "http",
                url: "https://example.com/mcp",
            }),
        ).toBeUndefined();
    });
});
