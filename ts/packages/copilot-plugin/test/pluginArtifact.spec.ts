// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HookOutput } from "../src/hooks/types.js";

interface PluginMcpManifest {
    mcpServers: Record<
        string,
        { command: string; args: string[]; tools: string[] }
    >;
}

interface PluginManifest {
    extensions: string;
}

describe("staged plugin artifact", () => {
    it("consumes mode commands in the bundled hook without backend connections", async () => {
        const directory = await mkdtemp(
            path.join(tmpdir(), "typeagent-mode-artifact-"),
        );
        let connections = 0;
        const server = createServer((socket) => {
            connections++;
            socket.destroy();
        });
        try {
            server.listen(0, "127.0.0.1");
            await once(server, "listening");
            const address = server.address();
            if (!address || typeof address === "string") {
                throw new Error("Expected a TCP address");
            }
            const pluginRoot = path.resolve(
                path.dirname(fileURLToPath(import.meta.url)),
                "..",
                "..",
            );
            const configPath = path.join(directory, "config.json");
            await writeFile(
                configPath,
                JSON.stringify({
                    mode: "direct",
                    powershell: { enabled: false },
                }),
            );
            const env: NodeJS.ProcessEnv = {
                ...process.env,
                TYPEAGENT_PLUGIN_DATA: directory,
                TYPEAGENT_HOST: "127.0.0.1",
                TYPEAGENT_PORT: String(address.port),
            };
            delete env.TYPEAGENT_MODE;
            for (const [args, response] of [
                ["mcp mixed", "TypeAgent mode switched to mcp (mixed)."],
                ["", "TypeAgent mode: mcp (mixed)"],
                ["mcp typo", "Usage:"],
                ["mcp mixed extra", "Usage:"],
                ["direct mixed", "Usage:"],
                ["mcp\nmixed\nextra", "Usage:"],
                ["mcp\ndelegate", "TypeAgent mode switched to mcp (delegate)."],
                ["mcp", "TypeAgent mode switched to mcp (delegate)."],
                ["MCP MIXED", "TypeAgent mode switched to mcp (mixed)."],
            ]) {
                const child = spawn(
                    process.execPath,
                    [path.join(pluginRoot, "dist", "hooks", "hook-router.js")],
                    { env, timeout: 10000, stdio: ["pipe", "pipe", "pipe"] },
                );
                let stdout = "";
                let stderr = "";
                child.stdout.setEncoding("utf8").on("data", (chunk) => {
                    stdout += chunk;
                });
                child.stderr.setEncoding("utf8").on("data", (chunk) => {
                    stderr += chunk;
                });
                child.stdin.end(
                    JSON.stringify({
                        sessionId: "mode-artifact",
                        timestamp: 1,
                        cwd: directory,
                        prompt: `@typeagent mode ${args}`,
                    }),
                );
                const [code] = await once(child, "close");
                expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
                const output = JSON.parse(stdout) as HookOutput;
                expect(output.handled).toBe(true);
                expect(output.responseContent).toContain(response);
                expect(output.modifiedPrompt).toBeUndefined();
                expect(output.additionalContext).toBeUndefined();
                expect(connections).toBe(0);
            }
            expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
                mode: "mcp",
                mcpRouting: "mixed",
                powershell: { enabled: false },
            });
        } finally {
            await new Promise<void>((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
            });
            await rm(directory, { recursive: true, force: true });
        }
    });

    it("contains the extension bundle at the declared discovery path", async () => {
        const testDir = path.dirname(fileURLToPath(import.meta.url));
        const pluginRoot = path.resolve(testDir, "..", "..");
        const manifest = JSON.parse(
            await readFile(path.join(pluginRoot, "plugin.json"), "utf8"),
        ) as PluginManifest;
        const bundle = await readFile(
            path.join(
                pluginRoot,
                "dist",
                manifest.extensions,
                "typeagent",
                "extension.mjs",
            ),
            "utf8",
        );

        expect(manifest.extensions).toBe("extensions/");
        expect(bundle).toContain('from "@github/copilot-sdk/extension"');
        expect(bundle).toContain("TYPEAGENT_SELECTED_SKILLS");
        expect(bundle).toContain("skillDirectories");
    });

    it("registers the structured Direct bridge in the actual bundled agent server", async () => {
        const pluginRoot = path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            "..",
            "..",
        );
        const transport = new StdioClientTransport({
            command: process.execPath,
            args: [path.join(pluginRoot, "dist/mcp/server.js")],
            stderr: "pipe",
        });
        const client = new Client({
            name: "structured-artifact-test",
            version: "1",
        });
        try {
            await client.connect(transport);
            const catalog = await client.listTools();
            const titles = Object.fromEntries(
                catalog.tools.map((tool) => [tool.name, tool.title]),
            );
            expect(titles).toMatchObject({
                "typeagent-processCommand":
                    "TypeAgent: Natural-language delegation",
                "typeagent-searchActions": "TypeAgent: Structured discovery",
                "typeagent-executeAction": "TypeAgent: Structured execution",
                "typeagent-continueAction":
                    "TypeAgent: Structured continuation",
                "typeagent-cancelAction": "TypeAgent: Structured cancellation",
            });
            expect(catalog.tools.map((tool) => tool.name)).toEqual(
                expect.arrayContaining([
                    "typeagent-searchActions",
                    "typeagent-executeAction",
                    "typeagent-continueAction",
                    "typeagent-cancelAction",
                    "typeagent-processCommand",
                ]),
            );
            expect(catalog.tools.map((tool) => tool.name)).not.toContain(
                "typeagent-getActionContract",
            );
            expect(
                catalog.tools.find(
                    (tool) => tool.name === "typeagent-searchActions",
                )?.inputSchema.required,
            ).toEqual(["query"]);
        } finally {
            await client.close();
        }
    });
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

    it("starts the bundled skills server declared by .mcp.json", async () => {
        const testDir = path.dirname(fileURLToPath(import.meta.url));
        const pluginRoot = path.resolve(testDir, "..", "..");
        const manifest = JSON.parse(
            await readFile(path.join(pluginRoot, ".mcp.json"), "utf8"),
        ) as PluginMcpManifest;
        const registration = manifest.mcpServers["typeagent-skills"];

        expect(registration).toEqual({
            command: "node",
            args: ["${PLUGIN_ROOT}/dist/mcp/server.js", "--skills"],
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
            name: "typeagent-skills-artifact-test",
            version: "1.0.0",
        });
        try {
            await client.connect(transport);
            const catalog = await client.listTools();
            expect(catalog.tools.map((tool) => tool.name)).toEqual([
                "typeagent-listSkills",
                "typeagent-searchSkills",
                "typeagent-getSkill",
                "typeagent-previewProcedureArtifact",
                "typeagent-promoteProcedureArtifact",
                "typeagent-previewSkillAcquisition",
                "typeagent-checkSkillUpdate",
                "typeagent-acquireAndPublishSkill",
                "typeagent-updateSkill",
            ]);
            expect(
                catalog.tools.find(
                    ({ name }) => name === "typeagent-previewProcedureArtifact",
                )?.annotations,
            ).toMatchObject({ readOnlyHint: true });
            expect(
                catalog.tools.find(
                    ({ name }) => name === "typeagent-updateSkill",
                )?.annotations,
            ).toMatchObject({ readOnlyHint: false });
            const templates = await client.listResourceTemplates();
            expect(templates.resourceTemplates).toEqual([
                expect.objectContaining({
                    name: "typeagent-skill-file",
                    uriTemplate:
                        "typeagent-skills://catalog/{identity}/{revision}/files/{file}",
                }),
            ]);
        } finally {
            await client.close();
        }
    });
});
