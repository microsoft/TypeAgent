// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { UserPromptSubmittedOutput } from "@typeagent/agent-harness-hooks/copilot-cli";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import {
    copyFile,
    mkdir,
    mkdtemp,
    readFile,
    rm,
    writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

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
    it("compiles and executes actual contained programs from copied dependency assets", async () => {
        const pluginRoot = path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            "..",
            "..",
        );
        const result = await promisify(execFile)(
            process.execPath,
            [
                "--test",
                "--test-reporter=tap",
                path.join(
                    pluginRoot,
                    "scripts",
                    "test",
                    "checkpoint-c-package.spec.mjs",
                ),
            ],
            { cwd: pluginRoot, timeout: 60_000 },
        );
        expect(result.stdout).toContain("# fail 0");
    }, 65_000);

    it.each([
        ["agent", []],
        ["workspace", ["--workspace"]],
        ["macros", ["--macros"]],
        ["skills", ["--skills"]],
    ] as const)(
        "starts the copied %s MCP bundle without a checkout or backend",
        async (kind, selectors) => {
            const directory = await mkdtemp(
                path.join(tmpdir(), "typeagent standalone artifact "),
            );
            const backend = createServer((socket) => {
                connections++;
                socket.destroy();
            });
            let connections = 0;
            const client = new Client({
                name: "standalone-artifact-test",
                version: "1",
            });
            try {
                backend.listen(0, "127.0.0.1");
                await once(backend, "listening");
                const address = backend.address();
                if (!address || typeof address === "string") {
                    throw new Error("Expected a TCP address");
                }
                const pluginRoot = path.resolve(
                    path.dirname(fileURLToPath(import.meta.url)),
                    "..",
                    "..",
                );
                const entry = path.join(directory, "dist", "mcp", "server.js");
                await mkdir(path.dirname(entry), { recursive: true });
                await copyFile(
                    path.join(pluginRoot, "dist", "mcp", "server.js"),
                    entry,
                );
                await writeFile(
                    path.join(directory, "package.json"),
                    JSON.stringify({ type: "module" }),
                );
                const transport = new StdioClientTransport({
                    command: process.execPath,
                    args: [entry, ...selectors],
                    cwd: directory,
                    env: {
                        ...(process.env.SystemRoot
                            ? { SystemRoot: process.env.SystemRoot }
                            : {}),
                        HOME: directory,
                        USERPROFILE: directory,
                        APPDATA: directory,
                        LOCALAPPDATA: directory,
                        TYPEAGENT_PLUGIN_DATA: path.join(directory, "data"),
                        TYPEAGENT_HOST: "127.0.0.1",
                        TYPEAGENT_PORT: String(address.port),
                    },
                    stderr: "pipe",
                });
                let diagnostics = "";
                transport.stderr?.on("data", (chunk: Buffer) => {
                    diagnostics += chunk.toString("utf8");
                });
                try {
                    await client.connect(transport);
                } catch (error) {
                    throw new Error(
                        `Copied ${kind} MCP startup failed: ${String(error)}\n${diagnostics}`,
                    );
                }
                const catalog = await client.listTools();
                expect(catalog.tools.length).toBeGreaterThan(0);
                expect(connections).toBe(0);
            } finally {
                await client.close();
                await new Promise<void>((resolve, reject) => {
                    backend.close((error) =>
                        error ? reject(error) : resolve(),
                    );
                });
                await rm(directory, { recursive: true, force: true });
            }
        },
    );

    it("keeps explicit catalog review but removes inspection from the macro run skill", async () => {
        const skill = await readFile(
            path.resolve(
                path.dirname(fileURLToPath(import.meta.url)),
                "..",
                "..",
                "skills",
                "typeagent-macros",
                "SKILL.md",
            ),
            "utf8",
        );
        expect(skill).toContain("current approved immutable program revision");
        expect(skill).toContain("If required inputs are not known");
        expect(skill).toContain("as an execution prerequisite");
        expect(skill).toContain("explicit catalog inspection and draft review");
        expect(skill).not.toContain("typeagent-macro-runner");
        expect(skill).not.toContain("submit_macro_candidate");
        expect(skill).not.toContain(
            "Use `inspect_macro` and `get_macro_requirements` before execution",
        );
    });

    it("consumes mode and recipe commands in a copied hook without backend connections", async () => {
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
            const hook = path.join(
                directory,
                "dist",
                "hooks",
                "hook-router.js",
            );
            await mkdir(path.dirname(hook), { recursive: true });
            await copyFile(
                path.join(pluginRoot, "dist", "hooks", "hook-router.js"),
                hook,
            );
            await writeFile(
                path.join(directory, "package.json"),
                JSON.stringify({ type: "module" }),
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
                TYPEAGENT_MACRO_RECORDING_ENABLED: "false",
            };
            delete env.TYPEAGENT_MODE;
            const runHook = async (
                prompt: string,
            ): Promise<UserPromptSubmittedOutput> => {
                const child = spawn(process.execPath, [hook], {
                    env,
                    cwd: directory,
                    timeout: 10000,
                    stdio: ["pipe", "pipe", "pipe"],
                });
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
                        prompt,
                    }),
                );
                const [code] = await once(child, "close");
                if (code !== 0) {
                    throw new Error(
                        `Copied hook exited with code ${code}: ${stderr}`,
                    );
                }
                if (prompt === "@typeagent recipe status" && stderr !== "") {
                    expect(stderr).toMatch(
                        /^\(node:\d+\) ExperimentalWarning: SQLite is an experimental feature and might change at any time\r?\n\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)\r?\n$/,
                    );
                } else {
                    expect(stderr).toBe("");
                }
                return JSON.parse(stdout) as UserPromptSubmittedOutput;
            };
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
                const output = await runHook(`@typeagent mode ${args}`);
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
            for (const owner of ["plugin", "typeagent"]) {
                const recipeOwner = await runHook(
                    `@typeagent recipe owner ${owner}`,
                );
                expect(recipeOwner.handled).toBe(true);
                expect(recipeOwner.responseContent).toContain(
                    `Recipe owner: ${owner}.`,
                );
                expect(recipeOwner.modifiedPrompt).toBeUndefined();
                expect(recipeOwner.additionalContext).toBeUndefined();
                expect(connections).toBe(0);
            }
            const prompt =
                "Compare PRs #3058, #3059, and #2993 and recommend smoke tests.";
            for (const policy of ["mixed", "delegate"]) {
                await runHook(`@typeagent mode mcp ${policy}`);
                const output = await runHook(prompt);
                expect(output.modifiedPrompt).toBe(prompt);
                expect(output.additionalContext).toContain(
                    "TypeAgent is the preferred action provider in MCP mode",
                );
                expect(output.additionalContext).toContain(
                    "Native tools are a fallback only after establishing",
                );
                if (policy === "mixed") {
                    expect(output.additionalContext).toContain(
                        "rather than native GitHub tools, gh, or web/API fetches",
                    );
                } else {
                    expect(output.additionalContext).toContain(
                        "You MUST call the typeagent-processCommand",
                    );
                    expect(output.additionalContext).not.toContain(
                        "typeagent-searchActions",
                    );
                }
                expect(connections).toBe(0);
            }
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
        expect(bundle).toContain(
            "TypeAgent is the preferred action provider in MCP mode",
        );
        expect(bundle).toContain(
            "otherwise discover a suitable capability before choosing native tools",
        );
        expect(bundle.includes("typeagent-macro-runner")).toBe(false);
        expect(bundle.includes("macro-runner-hosts")).toBe(false);
        expect(bundle).toContain("TYPEAGENT_WORKIQ_SDK_ORIGINALS_POLICY");
        expect(bundle).toContain("workiq-sdk-originals-v1");
        expect(bundle).toContain(
            "WorkIQ native binary/model-input exposure boundary is not admitted.",
        );
        expect(bundle).toContain(
            "WorkIQ SDK capture requires an owned native control context.",
        );
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
                expect.arrayContaining(["list_macros", "run_macro"]),
            );
            expect(catalog.tools.map((tool) => tool.name)).not.toEqual(
                expect.arrayContaining([
                    "create_macro_from_trace",
                    "submit_macro_candidate",
                ]),
            );
            const runSchema = catalog.tools.find(
                (tool) => tool.name === "run_macro",
            )!.inputSchema;
            expect(runSchema.properties).not.toHaveProperty("preference");
            expect(
                catalog.tools.find((tool) => tool.name === "inspect_macro")
                    ?.annotations,
            ).toEqual({
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            });
            for (const name of ["run_macro", "approve_macro"]) {
                expect(
                    catalog.tools.find((tool) => tool.name === name)
                        ?.annotations?.readOnlyHint,
                ).not.toBe(true);
            }
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
                "typeagent-previewSkillAcquisition",
                "typeagent-checkSkillUpdate",
                "typeagent-acquireAndPublishSkill",
                "typeagent-updateSkill",
            ]);
            expect(
                catalog.tools.find(
                    ({ name }) => name === "typeagent-previewSkillAcquisition",
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
