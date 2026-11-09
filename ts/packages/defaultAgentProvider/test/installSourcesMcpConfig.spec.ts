// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMcpConfigSource } from "../src/installSources/mcpConfigSource.js";

function writeConfig(contents: object | string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-mcp-config-"));
    const file = path.join(dir, "mcp.json");
    fs.writeFileSync(
        file,
        typeof contents === "string" ? contents : JSON.stringify(contents),
    );
    return file;
}

describe("mcpConfigSource", () => {
    it("lists servers from an `mcpServers` file as mcp rows", async () => {
        const file = writeConfig({
            mcpServers: {
                filesystem: {
                    command: "node",
                    args: ["fs-server.js"],
                    description: "local files",
                },
                web: { url: "https://example.com/mcp" },
            },
        });
        const source = createMcpConfigSource({
            kind: "mcp-config",
            name: "mcp",
            file,
        });
        const rows = await source.listAgents!();
        expect(rows).toHaveLength(2);
        for (const row of rows) {
            expect(row.extensionKind).toBe("mcp");
            expect(row.source).toBe("mcp");
        }
        const fsRow = rows.find((r) => r.ref === "filesystem");
        expect(fsRow?.defaultAgentName).toBe("filesystem");
        expect(fsRow?.description).toBe("local files");
    });

    it("lists servers from a VS Code `servers` file", async () => {
        const file = writeConfig({
            servers: {
                git: { command: "uvx", args: ["mcp-server-git"] },
            },
        });
        const source = createMcpConfigSource({
            kind: "mcp-config",
            name: "mcp",
            file,
        });
        const rows = await source.listAgents!();
        expect(rows.map((r) => r.ref)).toEqual(["git"]);
        expect(rows[0].extensionKind).toBe("mcp");
    });

    it("resolves normalized MCP candidates without native materialization", async () => {
        const file = writeConfig({
            mcpServers: {
                web: { url: "https://example.com/mcp" },
            },
        });
        const source = createMcpConfigSource({
            kind: "mcp-config",
            name: "mcp",
            file,
        });
        const candidate = await source.findMcp!("web");
        expect(candidate).toMatchObject({
            source: "mcp",
            sourceKind: "mcp-config",
            ref: "web",
            config: {
                id: "mcp:mcp:web",
                enabled: false,
                trust: "untrusted",
                transport: { kind: "http" },
                provenance: {
                    source: "mcp",
                    sourceKind: "mcp-config",
                    ref: "web",
                },
            },
        });
    });

    it("re-reads the local config when resolving an update", async () => {
        const file = writeConfig({
            mcpServers: {
                web: { url: "https://example.com/v1" },
            },
        });
        const source = createMcpConfigSource({
            kind: "mcp-config",
            name: "mcp",
            file,
        });
        expect((await source.findMcp!("web"))?.config.transport).toMatchObject({
            url: "https://example.com/v1",
        });
        fs.writeFileSync(
            file,
            JSON.stringify({
                mcpServers: {
                    web: { url: "https://example.com/v2" },
                },
            }),
        );
        expect((await source.findMcp!("web"))?.config.transport).toMatchObject({
            url: "https://example.com/v2",
        });
    });

    it("never resolves through the agent walk (find/materialize)", async () => {
        const file = writeConfig({
            mcpServers: { web: { url: "https://example.com/mcp" } },
        });
        const source = createMcpConfigSource({
            kind: "mcp-config",
            name: "mcp",
            file,
        });
        expect(await source.find("web")).toBeUndefined();
        await expect(
            source.materialize({ source: "mcp", ref: "web" }),
        ).rejects.toThrow(/cannot materialize/);
    });

    it("degrades to an empty list with a warning on a missing file", async () => {
        const source = createMcpConfigSource({
            kind: "mcp-config",
            name: "mcp",
            file: path.join(os.tmpdir(), "does-not-exist-xyz.json"),
        });
        const warnings: string[] = [];
        const rows = await source.listAgents!((m) => warnings.push(m));
        expect(rows).toEqual([]);
        expect(warnings.some((w) => /Could not read/.test(w))).toBe(true);
    });

    it("reports a malformed server entry but keeps the good ones", async () => {
        const file = writeConfig({
            mcpServers: {
                good: { command: "node", args: ["s.js"] },
                bad: 42,
            },
        });
        const source = createMcpConfigSource({
            kind: "mcp-config",
            name: "mcp",
            file,
        });
        const warnings: string[] = [];
        const rows = await source.listAgents!((m) => warnings.push(m));
        expect(rows.map((r) => r.ref)).toEqual(["good"]);
        expect(warnings.some((w) => /bad/.test(w))).toBe(true);
    });

    it("describe returns the file path", () => {
        const file = writeConfig({ mcpServers: {} });
        const source = createMcpConfigSource({
            kind: "mcp-config",
            name: "mcp",
            file,
        });
        expect(source.describe()).toBe(file);
    });
});
