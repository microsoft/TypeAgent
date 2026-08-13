// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { McpAppAgentInfo } from "../src/mcpAgentProvider.js";
import {
    buildMcpSeed,
    makeScriptPathResolver,
    mcpInfoToNormalized,
} from "../src/mcp/mcpSeed.js";

function info(overrides: Partial<McpAppAgentInfo>): McpAppAgentInfo {
    return {
        emojiChar: "🔌",
        description: "a server",
        ...overrides,
    };
}

describe("mcpInfoToNormalized", () => {
    it("converts an http server", () => {
        const normalized = mcpInfoToNormalized(
            "web",
            info({ serverUrl: "https://example.com/mcp" }),
        );
        expect(normalized).toEqual({
            name: "web",
            scope: "shipped",
            trust: "trusted",
            description: "a server",
            emojiChar: "🔌",
            transport: { kind: "http", url: "https://example.com/mcp" },
        });
    });

    it("converts a .js script server to a node stdio launch", () => {
        const normalized = mcpInfoToNormalized(
            "js",
            info({ serverScript: "server.js", serverScriptArgs: ["--flag"] }),
            (p) => `/abs/${p}`,
        );
        expect(normalized).toMatchObject({
            name: "js",
            transport: {
                kind: "stdio",
                command: "node",
                args: ["/abs/server.js", "--flag"],
            },
        });
    });

    it("converts a .py script server to a python stdio launch", () => {
        const normalized = mcpInfoToNormalized(
            "py",
            info({ serverScript: "server.py" }),
        );
        const expectedCmd = process.platform === "win32" ? "python" : "python3";
        expect(normalized?.transport).toEqual({
            kind: "stdio",
            command: expectedCmd,
            args: ["server.py"],
        });
    });

    it("returns undefined for ArgDefinitions server args", () => {
        const normalized = mcpInfoToNormalized(
            "fs",
            info({
                serverScript: "server.js",
                serverScriptArgs: {
                    dirs: { type: "string", description: "dirs" },
                } as any,
            }),
        );
        expect(normalized).toBeUndefined();
    });

    it("returns undefined for a server with no url or script", () => {
        expect(mcpInfoToNormalized("empty", info({}))).toBeUndefined();
    });

    it("returns undefined for an unsupported script extension", () => {
        expect(
            mcpInfoToNormalized("sh", info({ serverScript: "run.sh" })),
        ).toBeUndefined();
    });
});

describe("buildMcpSeed", () => {
    it("returns an empty seed for undefined input", () => {
        expect(buildMcpSeed(undefined)).toEqual({});
    });

    it("includes convertible servers and skips non-convertible ones", () => {
        const seed = buildMcpSeed({
            web: info({ serverUrl: "https://example.com/mcp" }),
            fs: info({
                serverScript: "server.js",
                serverScriptArgs: {
                    dirs: { type: "string", description: "dirs" },
                } as any,
            }),
        });
        expect(Object.keys(seed)).toEqual(["web"]);
        expect(seed.web.transport).toEqual({
            kind: "http",
            url: "https://example.com/mcp",
        });
    });
});

describe("makeScriptPathResolver", () => {
    it("resolves relative paths against the base and leaves absolute paths", () => {
        const resolve = makeScriptPathResolver("/base/dir");
        expect(resolve("rel/server.js")).toContain("server.js");
        const abs =
            process.platform === "win32" ? "C:\\abs\\x.js" : "/abs/x.js";
        expect(resolve(abs)).toBe(abs);
    });
});
