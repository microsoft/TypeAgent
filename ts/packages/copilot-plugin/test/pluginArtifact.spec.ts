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

interface PluginManifest {
    extensions: string;
}

describe("staged plugin artifact", () => {
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
                    "TypeAgent: Natural-language delegation (processCommand)",
                "typeagent-searchActions":
                    "TypeAgent: Structured discovery (searchActions)",
                "typeagent-executeAction":
                    "TypeAgent: Structured execution (executeAction)",
                "typeagent-continueAction":
                    "TypeAgent: Structured continuation (continueAction)",
                "typeagent-cancelAction":
                    "TypeAgent: Structured cancellation (cancelAction)",
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
