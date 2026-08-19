// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    detectMcpConfigFormat,
    importMcpConfig,
} from "../src/mcp/mcpConfigImport.js";

describe("detectMcpConfigFormat", () => {
    it("detects the vscode 'servers' form", () => {
        expect(detectMcpConfigFormat({ servers: {} })).toBe("vscode");
    });

    it("detects the 'mcpServers' form", () => {
        expect(detectMcpConfigFormat({ mcpServers: {} })).toBe("mcpServers");
    });

    it("prefers vscode when both keys are present", () => {
        expect(detectMcpConfigFormat({ servers: {}, mcpServers: {} })).toBe(
            "vscode",
        );
    });

    it("returns undefined when neither key is present", () => {
        expect(detectMcpConfigFormat({ other: 1 })).toBeUndefined();
    });
});

describe("importMcpConfig - mcpServers format", () => {
    it("imports a stdio server with args and env", () => {
        const result = importMcpConfig({
            mcpServers: {
                fs: {
                    command: "npx",
                    args: ["-y", "@modelcontextprotocol/server-filesystem"],
                    env: { ROOT: "/tmp" },
                },
            },
        });
        expect(result.errors).toHaveLength(0);
        expect(result.servers).toHaveLength(1);
        const cfg = result.servers[0].config;
        expect(cfg.id).toBe("fs");
        expect(cfg.name).toBe("fs");
        expect(cfg.transport).toEqual({
            kind: "stdio",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem"],
            env: { ROOT: "/tmp" },
        });
        expect(cfg.scope).toBe("workspace");
        expect(cfg.trust).toBe("untrusted");
        expect(cfg.enabled).toBe(true);
        expect(cfg.provenance).toEqual({
            source: "imported-config",
            sourceKind: "mcp-config",
            ref: "fs",
        });
    });

    it("infers http transport from a bare url", () => {
        const result = importMcpConfig({
            mcpServers: {
                remote: {
                    url: "https://example.com/mcp",
                    timeoutMs: 5000,
                },
            },
        });
        expect(result.errors).toHaveLength(0);
        expect(result.servers[0].config.transport).toEqual({
            kind: "http",
            url: "https://example.com/mcp",
            timeoutMs: 5000,
        });
    });

    it("records an error for an entry with neither command nor url", () => {
        const result = importMcpConfig({
            mcpServers: { bad: { description: "nothing to launch" } },
        });
        expect(result.servers).toHaveLength(0);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].name).toBe("bad");
        expect(result.errors[0].reason).toMatch(/command/);
    });

    it("keeps good servers when one entry is malformed", () => {
        const result = importMcpConfig({
            mcpServers: {
                good: { command: "node", args: ["s.js"] },
                bad: { type: "http" },
            },
        });
        expect(result.servers.map((s) => s.name)).toEqual(["good"]);
        expect(result.errors.map((e) => e.name)).toEqual(["bad"]);
    });
});

describe("importMcpConfig - vscode format", () => {
    it("imports a stdio server and lifts an ${input:...} placeholder", () => {
        const result = importMcpConfig({
            inputs: [{ id: "api-key", type: "promptString", password: true }],
            servers: {
                weather: {
                    type: "stdio",
                    command: "node",
                    args: ["weather.js"],
                    env: { API_KEY: "${input:api-key}" },
                },
            },
        });
        expect(result.errors).toHaveLength(0);
        const transport = result.servers[0].config.transport;
        expect(transport).toEqual({
            kind: "stdio",
            command: "node",
            args: ["weather.js"],
            env: { API_KEY: { kind: "input", name: "api-key" } },
        });
    });

    it("lifts an ${env:...} placeholder into an env credential reference", () => {
        const result = importMcpConfig({
            servers: {
                s: {
                    type: "stdio",
                    command: "run",
                    env: { TOKEN: "${env:MY_TOKEN}" },
                },
            },
        });
        expect((result.servers[0].config.transport as any).env).toEqual({
            TOKEN: { kind: "env", name: "MY_TOKEN" },
        });
    });

    it("leaves a partial placeholder as a literal string", () => {
        const result = importMcpConfig({
            servers: {
                s: {
                    type: "http",
                    url: "https://x",
                    headers: { Authorization: "Bearer ${input:tok}" },
                },
            },
        });
        expect((result.servers[0].config.transport as any).headers).toEqual({
            Authorization: "Bearer ${input:tok}",
        });
    });

    it("treats type 'sse' as an http transport", () => {
        const result = importMcpConfig({
            servers: { s: { type: "sse", url: "https://x/sse" } },
        });
        expect(result.servers[0].config.transport).toEqual({
            kind: "http",
            url: "https://x/sse",
        });
    });
});

describe("importMcpConfig - error handling", () => {
    it("errors when the root is not an object", () => {
        const result = importMcpConfig("nope");
        expect(result.servers).toHaveLength(0);
        expect(result.errors).toHaveLength(1);
    });

    it("errors when no server map key is present", () => {
        const result = importMcpConfig({ something: {} });
        expect(result.errors[0].reason).toMatch(/mcpServers.*servers/);
    });
});
