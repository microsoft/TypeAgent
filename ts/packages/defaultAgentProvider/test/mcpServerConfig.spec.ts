// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    NormalizedMcpServerConfig,
    resolveEnvValue,
    toTransportConfig,
} from "../src/mcp/mcpServerConfig.js";

describe("resolveEnvValue", () => {
    it("returns literal strings unchanged", () => {
        expect(resolveEnvValue("plain")).toBe("plain");
    });

    it("resolves env references from the supplied environment", () => {
        expect(
            resolveEnvValue({ kind: "env", name: "TOKEN" }, undefined, {
                TOKEN: "secret",
            }),
        ).toBe("secret");
    });

    it("resolves input references from the supplied inputs", () => {
        expect(
            resolveEnvValue(
                { kind: "input", name: "api-key" },
                {
                    "api-key": "abc",
                },
            ),
        ).toBe("abc");
    });

    it("returns undefined for an unresolvable reference", () => {
        expect(
            resolveEnvValue({ kind: "env", name: "MISSING" }, undefined, {}),
        ).toBeUndefined();
    });
});

describe("toTransportConfig", () => {
    it("maps an http config to an http transport", () => {
        const config: NormalizedMcpServerConfig = {
            name: "remote",
            transport: { kind: "http", url: "https://example.com/mcp" },
        };
        expect(toTransportConfig(config)).toEqual({
            kind: "http",
            url: "https://example.com/mcp",
        });
    });

    it("maps a stdio config and resolves env references", () => {
        const config: NormalizedMcpServerConfig = {
            name: "local",
            transport: {
                kind: "stdio",
                command: "node",
                args: ["server.js"],
                env: {
                    LITERAL: "x",
                    SECRET: { kind: "input", name: "key" },
                },
                cwd: "/work",
            },
        };
        const result = toTransportConfig(config, { key: "resolved" });
        expect(result).toEqual({
            kind: "stdio",
            command: "node",
            args: ["server.js"],
            env: { LITERAL: "x", SECRET: "resolved" },
            cwd: "/work",
        });
    });

    it("omits unresolved env entries instead of emitting undefined", () => {
        const config: NormalizedMcpServerConfig = {
            name: "local",
            transport: {
                kind: "stdio",
                command: "node",
                env: { MISSING: { kind: "env", name: "NOPE" } },
            },
        };
        const result = toTransportConfig(config, undefined, {});
        expect(result).toEqual({
            kind: "stdio",
            command: "node",
            args: [],
            env: {},
        });
    });

    it("defaults args to an empty array when absent", () => {
        const config: NormalizedMcpServerConfig = {
            name: "local",
            transport: { kind: "stdio", command: "run" },
        };
        expect(toTransportConfig(config)).toEqual({
            kind: "stdio",
            command: "run",
            args: [],
        });
    });
});
