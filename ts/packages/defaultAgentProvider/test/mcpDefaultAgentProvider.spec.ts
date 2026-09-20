// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    createMcpAppAgentSourceForInstance,
    getDefaultMcpAppAgentProvider,
} from "../src/mcpDefaultAgentProvider.js";
import { getInstanceConfigProvider } from "../src/utils/config.js";

const tempDirs: string[] = [];

function tmpDir(prefix: string): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(directory);
    return directory;
}

function tmpInstanceDir(): string {
    return tmpDir("ta-mcp-default-");
}

function filesystemArgs(instanceDir: string) {
    const configs = getInstanceConfigProvider(instanceDir);
    const source = createMcpAppAgentSourceForInstance(configs);
    const server = source.testApi.getServer("shipped:mcpfilesystem");
    if (server?.transport.kind !== "stdio") {
        throw new Error("Expected a shipped stdio filesystem server");
    }
    return server.transport.args ?? [];
}

describe("default MCP filesystem server", () => {
    afterEach(() => {
        for (const directory of tempDirs.splice(0)) {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    it("uses a dedicated per-instance sandbox and leaves the legacy provider", () => {
        const instanceDir = tmpInstanceDir();
        const args = filesystemArgs(instanceDir);
        const sandbox = path.join(instanceDir, "mcp-filesystem");

        expect(args).toHaveLength(2);
        expect(args[1]).toBe(sandbox);
        expect(fs.statSync(sandbox).isDirectory()).toBe(true);
        expect(
            getDefaultMcpAppAgentProvider(
                getInstanceConfigProvider(instanceDir),
            ),
        ).toBeUndefined();
    });

    it("honors existing configured directories and ignores invalid ones", () => {
        const instanceDir = tmpInstanceDir();
        const configuredRoot = tmpDir("ta-mcp-root-");
        const configs = getInstanceConfigProvider(instanceDir);
        configs.setInstanceConfig({
            mcpServers: {
                mcpfilesystem: {
                    serverScriptArgs: [
                        path.join(instanceDir, "missing"),
                        configuredRoot,
                    ],
                },
            },
        });

        const source = createMcpAppAgentSourceForInstance(configs);
        const server = source.testApi.getServer("shipped:mcpfilesystem");
        expect(server?.transport).toMatchObject({
            kind: "stdio",
            args: [expect.any(String), configuredRoot],
        });
    });

    it("initializes the official server and lists its tools", async () => {
        const instanceDir = tmpInstanceDir();
        const source = createMcpAppAgentSourceForInstance(
            getInstanceConfigProvider(instanceDir),
        );

        const result = await source.testApi.testServer("shipped:mcpfilesystem");

        expect(result.protocolVersion).toBeDefined();
        expect(result.tools).toEqual(
            expect.arrayContaining(["read_file", "list_directory"]),
        );
    });
});
