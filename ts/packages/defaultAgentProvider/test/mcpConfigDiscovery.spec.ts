// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { McpConfigDiscovery } from "../src/mcp/mcpConfigDiscovery.js";

async function writeConfig(
    filePath: string,
    key: "mcpServers" | "servers",
    servers: Record<string, unknown>,
) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify({ [key]: servers }));
}

describe("MCP config discovery", () => {
    it("applies explicit precedence across user and repository traversal", async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), "mcp-discovery-"));
        const home = path.join(root, "home");
        const repo = path.join(root, "repo");
        const workspace = path.join(repo, "packages", "app");
        await mkdir(path.join(repo, ".git"), { recursive: true });
        await mkdir(workspace, { recursive: true });
        await writeConfig(
            path.join(home, ".copilot", "mcp-config.json"),
            "mcpServers",
            { shared: { command: "user" }, userOnly: { command: "user" } },
        );
        await writeConfig(path.join(repo, ".mcp.json"), "mcpServers", {
            shared: { command: "root" },
        });
        await writeConfig(
            path.join(workspace, ".github", "mcp.json"),
            "mcpServers",
            { shared: { command: "github" } },
        );
        await writeConfig(path.join(workspace, ".mcp.json"), "mcpServers", {
            shared: { command: "workspace" },
        });

        const result = new McpConfigDiscovery().discover({
            homeDirectory: home,
            workspacePath: workspace,
            isFolderTrusted: () => true,
        });

        expect(result.repositoryRoot).toBe(repo);
        expect(
            result.configs.find((entry) => entry.config.name === "shared"),
        ).toMatchObject({
            filePath: path.join(workspace, ".mcp.json"),
            sourceKind: "workspace-mcp",
            config: {
                enabled: false,
                trust: "untrusted",
                transport: { command: "workspace" },
                provenance: {
                    source: path.join(workspace, ".mcp.json"),
                    sourceKind: "workspace-mcp",
                },
            },
        });
        expect(
            result.diagnostics.filter((d) => d.kind === "duplicate"),
        ).toHaveLength(3);
        expect(
            result.configs.some((entry) => entry.config.name === "userOnly"),
        ).toBe(true);
    });

    it("skips workspace files that fail folder trust and reports invalid entries", async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), "mcp-discovery-"));
        const workspace = path.join(root, "repo");
        await mkdir(path.join(workspace, ".git"), { recursive: true });
        await writeConfig(path.join(workspace, ".mcp.json"), "mcpServers", {
            hidden: { command: "hidden" },
        });
        const homeFile = path.join(root, "home", ".copilot", "mcp-config.json");
        await mkdir(path.dirname(homeFile), { recursive: true });
        fs.writeFileSync(homeFile, JSON.stringify({ mcpServers: { bad: 1 } }));

        const result = new McpConfigDiscovery().discover({
            homeDirectory: path.join(root, "home"),
            workspacePath: workspace,
            isFolderTrusted: () => false,
        });

        expect(result.configs).toEqual([]);
        expect(result.diagnostics).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ kind: "invalid", serverName: "bad" }),
                expect.objectContaining({ kind: "untrusted" }),
            ]),
        );
    });
});
