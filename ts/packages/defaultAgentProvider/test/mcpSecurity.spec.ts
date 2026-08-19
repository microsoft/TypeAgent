// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionMcpCredentialStore, JsonlMcpAuditSink } from "../src/index.js";
import { resolveTransportConfig } from "../src/mcp/mcpServerConfig.js";
import { enforceMcpPolicy } from "../src/mcp/mcpPolicy.js";
import { openMcpServerStore } from "../src/mcp/mcpServerStore.js";

const config = {
    id: "secure",
    name: "secure",
    enabled: true,
    trust: "trusted" as const,
    scope: "user" as const,
    provenance: { source: "test" },
    transport: {
        kind: "http" as const,
        url: "https://example.com/mcp",
        headers: {
            Authorization: {
                value: "Bearer {token}",
                variables: {
                    token: { kind: "secure" as const, name: "api-token" },
                },
            },
        },
    },
};

describe("MCP security host services", () => {
    it("resolves named credentials without persisting plaintext", async () => {
        const store = new SessionMcpCredentialStore({});
        await store.set("api-token", "secret-value");
        await expect(
            resolveTransportConfig(config, store),
        ).resolves.toMatchObject({
            headers: { Authorization: "Bearer secret-value" },
        });
        await expect(
            store.set("durable", "secret-value", { durable: true }),
        ).rejects.toThrow(/Durable MCP secret storage is not configured/);
        expect(JSON.stringify(config)).not.toContain("secret-value");
    });

    it("denies unapproved public registry materialization", () => {
        expect(() =>
            enforceMcpPolicy(
                {
                    allowedTransports: ["stdio"],
                    allowPublicNpmRegistry: false,
                },
                "install",
                {
                    ...config,
                    transport: { kind: "stdio", command: "node", args: [] },
                    provenance: {
                        source: "registry",
                        packageIdentifier: "unsafe-package",
                        npmRegistryUrl: "https://registry.npmjs.org/",
                    },
                },
            ),
        ).toThrow(/public npm registry materialization is disabled/);
    });

    it("refuses to persist plaintext credential headers", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-store-"));
        expect(() =>
            openMcpServerStore(dir).set({
                ...config,
                transport: {
                    kind: "http",
                    url: "https://example.com/mcp",
                    headers: { Authorization: "Bearer plaintext-value" },
                },
            }),
        ).toThrow(/cannot persist plaintext credential/);
    });

    it("writes sanitized bounded audit JSONL", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-audit-"));
        const sink = new JsonlMcpAuditSink(dir, 1024);
        await sink.write({
            timestamp: new Date().toISOString(),
            operation: "tool-invocation",
            configId: "secure",
            configName: "secure",
            tool: "send",
            arguments: {
                Authorization: "Bearer abcdefghijklmnop",
                password: "super-secret-password",
            },
        });
        const text = fs.readFileSync(path.join(dir, "mcp-audit.jsonl"), "utf8");
        expect(text).not.toContain("abcdefghijklmnop");
        expect(text).not.toContain("super-secret-password");
        expect(text).toContain("******");
    });

    it("redacts explicit sensitive values and rotates only at JSONL boundaries", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-audit-"));
        const sink = new JsonlMcpAuditSink(dir, 500);
        const sensitiveValue = "sensitive-value-under-safe-key";

        for (let index = 0; index < 8; index++) {
            await sink.write({
                timestamp: new Date().toISOString(),
                operation: "tool-invocation",
                configId: "secure",
                configName: "secure",
                arguments: {
                    note: sensitiveValue,
                    padding: "x".repeat(80),
                    index,
                },
                sensitiveValues: [sensitiveValue],
            });
        }

        const text = fs.readFileSync(path.join(dir, "mcp-audit.jsonl"), "utf8");
        expect(text).not.toContain(sensitiveValue);
        const lines = text.split("\n").filter((line) => line.length > 0);
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
            expect(() => JSON.parse(line)).not.toThrow();
        }
    });
});
