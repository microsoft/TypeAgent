// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface PluginMcpManifest {
    mcpServers: Record<
        string,
        { command: string; args: string[]; tools: string[] }
    >;
}

describe("staged plugin artifact", () => {
    it("starts the bundled macro server declared by .mcp.json", async () => {
        const testDir = path.dirname(fileURLToPath(import.meta.url));
        const pluginRoot = path.resolve(testDir, "..", "..");
        const manifest = JSON.parse(
            await readFile(path.join(pluginRoot, ".mcp.json"), "utf8"),
        ) as PluginMcpManifest;
        const registration = manifest.mcpServers["typeagent-macros"];

        expect(registration).toEqual({
            command: "node",
            args: ["${PLUGIN_ROOT}/dist/mcp/server.js", "--macros"],
            tools: ["*"],
        });

        const transport = new StdioClientTransport({
            command: process.execPath,
            args: registration.args.map((argument) =>
                argument.replace("${PLUGIN_ROOT}", pluginRoot),
            ),
            stderr: "pipe",
        });
        const client = new Client({
            name: "typeagent-plugin-artifact-test",
            version: "1.0.0",
        });
        try {
            await client.connect(transport);
            const catalog = await client.listTools();
            expect(catalog.tools.map((tool) => tool.name)).toEqual(
                expect.arrayContaining([
                    "list_macros",
                    "create_macro_from_trace",
                    "run_macro",
                    "submit_macro_candidate",
                ]),
            );
        } finally {
            await client.close();
        }
    });

    it("exposes the direct action tools on the bundled agent server", async () => {
        const testDir = path.dirname(fileURLToPath(import.meta.url));
        const pluginRoot = path.resolve(testDir, "..", "..");
        const manifest = JSON.parse(
            await readFile(path.join(pluginRoot, ".mcp.json"), "utf8"),
        ) as PluginMcpManifest;
        const registration = manifest.mcpServers["typeagent"];

        const transport = new StdioClientTransport({
            command: process.execPath,
            args: registration.args.map((argument) =>
                argument.replace("${PLUGIN_ROOT}", pluginRoot),
            ),
            stderr: "pipe",
        });
        const client = new Client({
            name: "typeagent-plugin-artifact-test",
            version: "1.0.0",
        });
        try {
            await client.connect(transport);
            const catalog = await client.listTools();
            expect(catalog.tools.map((tool) => tool.name)).toEqual(
                expect.arrayContaining([
                    "typeagent-processCommand",
                    "typeagent-discoverActions",
                    "typeagent-executeAction",
                    "typeagent-listAgents",
                    "typeagent-getStatus",
                ]),
            );
        } finally {
            await client.close();
        }
    });
});
