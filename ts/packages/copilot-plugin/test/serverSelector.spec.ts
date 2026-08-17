// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { selectMcpServer } from "../src/mcp/serverSelector.js";

describe("MCP server selection", () => {
    it.each([
        [[], "agent"],
        [["--workspace"], "workspace"],
        [["--macros"], "macros"],
    ] as const)("selects %s as %s", (args, expected) => {
        expect(selectMcpServer(args)).toBe(expected);
    });

    it("rejects conflicting logical server selectors", () => {
        expect(() => selectMcpServer(["--workspace", "--macros"])).toThrow(
            "Conflicting MCP server selectors",
        );
    });
});
