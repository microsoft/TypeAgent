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
    function config(
        transport: NormalizedMcpServerConfig["transport"],
    ): NormalizedMcpServerConfig {
        return {
            id: "test",
            name: "test",
            enabled: true,
            trust: "trusted",
            scope: "user",
            provenance: { source: "test" },
            transport,
        };
    }

    it("maps an http config to an http transport", () => {
        expect(
            toTransportConfig(
                config({
                    kind: "http",
                    url: "https://example.com/mcp",
                    headers: {
                        Literal: "plain",
                        Authorization: { kind: "env", name: "TOKEN" },
                    },
                    timeoutMs: 1234,
                }),
                undefined,
                { TOKEN: "Bearer secret" },
            ),
        ).toEqual({
            kind: "http",
            url: "https://example.com/mcp",
            headers: {
                Literal: "plain",
                Authorization: "Bearer secret",
            },
            timeoutMs: 1234,
        });
    });

    it("maps a stdio config and resolves env references", () => {
        const result = toTransportConfig(
            config({
                kind: "stdio",
                command: "node",
                args: ["server.js"],
                env: {
                    LITERAL: "x",
                    SECRET: { kind: "input", name: "key" },
                },
                cwd: "/work",
            }),
            { key: "resolved" },
        );
        expect(result).toEqual({
            kind: "stdio",
            command: "node",
            args: ["server.js"],
            env: { LITERAL: "x", SECRET: "resolved" },
            cwd: "/work",
        });
    });

    it("fails explicitly for unresolved stdio env references", () => {
        expect(() =>
            toTransportConfig(
                config({
                    kind: "stdio",
                    command: "node",
                    env: { MISSING: { kind: "env", name: "NOPE" } },
                }),
                undefined,
                {},
            ),
        ).toThrow(/environment variable 'MISSING'.*env:NOPE/);
    });

    it("fails explicitly for unresolved HTTP header references", () => {
        expect(() =>
            toTransportConfig(
                config({
                    kind: "http",
                    url: "https://example.com/mcp",
                    headers: {
                        Authorization: { kind: "input", name: "api-key" },
                    },
                }),
                {},
            ),
        ).toThrow(/HTTP header 'Authorization'.*input:api-key/);
    });

    it("defaults args to an empty array when absent", () => {
        expect(
            toTransportConfig(config({ kind: "stdio", command: "run" })),
        ).toEqual({
            kind: "stdio",
            command: "run",
            args: [],
        });
    });
});
