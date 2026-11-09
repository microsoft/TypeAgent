// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { joinSession } from "@github/copilot-sdk/extension";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export async function startJoinedProbe() {
    const session = await joinSession({
        tools: [
            {
                name: "host_capability_joined_probe",
                description: "Probe a disposable host-owned extension session.",
                parameters: {
                    type: "object",
                    properties: { path: { type: "string" } },
                    required: ["path"],
                },
                handler: async (input, invocation) => {
                    await session.rpc.tools.initializeAndValidate();
                    const metadata =
                        await session.rpc.tools.getCurrentMetadata();
                    const mcp = metadata.tools.find(
                        (tool) =>
                            tool.mcpServerName === "host-capability" &&
                            tool.mcpToolName === "echo",
                    );
                    if (!mcp)
                        throw new Error(
                            "Joined session cannot see fixture MCP tool.",
                        );
                    const native = await session.rpc.tools.execute({
                        name: "view",
                        arguments: { path: input.path },
                    });
                    const mcpResult = await session.rpc.tools.execute({
                        name: mcp.name,
                        arguments: {
                            value: "HOST_CAPABILITY_JOINED_MCP_OUTPUT",
                        },
                    });
                    const sdkExtensionModule = import.meta.resolve(
                        "@github/copilot-sdk/extension",
                    );
                    let sdkPackageVersion;
                    try {
                        sdkPackageVersion = JSON.parse(
                            await readFile(
                                new URL("./package.json", sdkExtensionModule),
                                "utf8",
                            ),
                        ).version;
                    } catch {
                        sdkPackageVersion =
                            "package metadata not shipped beside extension module";
                    }
                    const sdkExtensionSha256 = createHash("sha256")
                        .update(await readFile(new URL(sdkExtensionModule)))
                        .digest("hex");
                    return {
                        resultType: "success",
                        textResultForLlm: JSON.stringify({
                            sessionMatches:
                                session.sessionId === invocation.sessionId,
                            pid: process.pid,
                            parentPid: process.ppid,
                            sdkExtensionModule,
                            sdkPackageVersion,
                            sdkExtensionSha256,
                            native,
                            mcp: mcpResult,
                        }),
                    };
                },
            },
        ],
    });
    process.once(
        "SIGTERM",
        () => void session.disconnect().finally(() => process.exit(0)),
    );
}

if (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const server = new McpServer({
        name: "host-capability-local-only",
        version: "1.0.0",
    });
    server.registerTool(
        "echo",
        {
            description:
                "Pure local echo. No network, credentials, or business data.",
            inputSchema: { value: z.string() },
            outputSchema: { value: z.string() },
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async ({ value }) => ({
            content: [{ type: "text", text: value }],
            structuredContent: { value },
        }),
    );
    await server.connect(new StdioServerTransport());
}
