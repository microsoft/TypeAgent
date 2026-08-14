import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { McpReplayHost } from "../src/mcp/mcpReplayHost.js";
import type { NormalizedMcpServerConfig } from "../src/mcp/mcpServerConfig.js";

describe("MCP replay host", () => {
    it("replays the captured tool without applying a second permission model", async () => {
        const instanceDir = await mkdtemp(
            path.join(os.tmpdir(), "mcp-replay-"),
        );
        const config: NormalizedMcpServerConfig = {
            id: "example",
            name: "example",
            transport: { kind: "stdio", command: "unused" },
            enabled: false,
            trust: "untrusted",
            scope: "workspace",
            provenance: { source: "captured-test" },
            deniedTools: ["create_item"],
            toolApproval: { deny: ["create_item"] },
        };
        const calls: Array<{
            name: string;
            argumentsValue: Record<string, unknown> | undefined;
        }> = [];
        const callTool = async (
            name: string,
            argumentsValue: Record<string, unknown> | undefined,
        ) => {
            calls.push({ name, argumentsValue });
            return {
                content: [{ type: "text" as const, text: "created" }],
                structuredContent: { id: "item-1" },
            };
        };
        const host = new McpReplayHost(instanceDir, {
            configs: [config],
            audit: { write: async () => {} },
            connectionFactory: async () => ({
                listTools: async () => [
                    {
                        name: "create_item",
                        description: "Creates an item",
                        inputSchema: {
                            type: "object",
                            properties: { name: { type: "string" } },
                            required: ["name"],
                        },
                        outputSchema: {
                            type: "object",
                            properties: { id: { type: "string" } },
                            required: ["id"],
                        },
                        annotations: {
                            readOnlyHint: false,
                            destructiveHint: true,
                        },
                    },
                ],
                callTool,
                close: async () => {},
            }),
        });

        await expect(
            host.inspectTool("example", "create_item"),
        ).resolves.toMatchObject({ toolName: "create_item" });
        await expect(
            host.callTool(
                "example",
                "create_item",
                { name: "demo" },
                new AbortController().signal,
            ),
        ).resolves.toEqual({ id: "item-1" });
        expect(calls).toEqual([
            { name: "create_item", argumentsValue: { name: "demo" } },
        ]);
        await host.close();
    });

    it("discovers the captured workspace MCP configuration", async () => {
        const instanceDir = await mkdtemp(
            path.join(os.tmpdir(), "mcp-replay-"),
        );
        const workspaceDir = await mkdtemp(
            path.join(os.tmpdir(), "mcp-workspace-"),
        );
        await writeFile(
            path.join(workspaceDir, ".mcp.json"),
            JSON.stringify({
                mcpServers: {
                    workspaceApi: {
                        command: "unused",
                        args: [],
                    },
                },
            }),
        );
        const connectedConfigs: NormalizedMcpServerConfig[] = [];
        const host = new McpReplayHost(instanceDir, {
            configs: [],
            audit: { write: async () => {} },
            connectionFactory: async (config) => {
                connectedConfigs.push(config);
                return {
                    listTools: async () => [
                        {
                            name: "repeat_action",
                            inputSchema: {
                                type: "object",
                                properties: {},
                            },
                        },
                    ],
                    callTool: async () => ({ content: [] }),
                    close: async () => {},
                };
            },
        });

        await expect(
            host.inspectTool("workspaceApi", "repeat_action", {
                cwd: workspaceDir,
            }),
        ).resolves.toMatchObject({
            mcpServerName: "workspaceApi",
            toolName: "repeat_action",
        });
        expect(connectedConfigs).toMatchObject([
            {
                id: "workspace:workspaceApi",
                trust: "untrusted",
                provenance: { source: path.join(workspaceDir, ".mcp.json") },
            },
        ]);
        await host.close();
    });
});
