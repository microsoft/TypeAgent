// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeConfig } from "../src/shared/plugin-config.js";

const connectDispatcher = jest.fn(async () => ({}));
jest.unstable_mockModule("@typeagent/agent-server-client", () => ({
    connectDispatcher,
    connectAgentServer: jest.fn(),
}));
const { connectToTypeAgent, createClientIO } = await import(
    "../src/shared/typeagent-client.js"
);

describe("mixed natural-language conversation selection", () => {
    let directory: string;
    const environment = {
        TYPEAGENT_PLUGIN_DATA: process.env.TYPEAGENT_PLUGIN_DATA,
        TYPEAGENT_MODE: process.env.TYPEAGENT_MODE,
        TYPEAGENT_CONVERSATION_ID: process.env.TYPEAGENT_CONVERSATION_ID,
    };
    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), "mixed-nl-binding-"));
        process.env.TYPEAGENT_PLUGIN_DATA = directory;
        delete process.env.TYPEAGENT_MODE;
        delete process.env.TYPEAGENT_CONVERSATION_ID;
        connectDispatcher.mockClear();
    });
    afterEach(() => {
        rmSync(directory, { recursive: true, force: true });
        for (const [key, value] of Object.entries(environment)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    it.each(["default", "config", "environment"] as const)(
        "uses the same %s context selection as the mixed structured client",
        async (source) => {
            writeConfig({
                mode: "mcp",
                mcpRouting: "mixed",
                ...(source === "default"
                    ? {}
                    : { conversationId: "configured" }),
            });
            if (source === "environment")
                process.env.TYPEAGENT_CONVERSATION_ID = "environment";
            const io = createClientIO({});
            await connectToTypeAgent(io);
            expect(connectDispatcher).toHaveBeenCalledWith(
                io,
                expect.any(String),
                {
                    filter: true,
                    clientType: "shell",
                    ...(source === "default"
                        ? {}
                        : {
                              conversationId:
                                  source === "config"
                                      ? "configured"
                                      : "environment",
                          }),
                },
            );
        },
    );

    it("preserves default delegate selection despite structured-only configuration", async () => {
        writeConfig({
            mode: "mcp",
            mcpRouting: "delegate",
            conversationId: "structured-only",
        });
        const io = createClientIO({});
        await connectToTypeAgent(io);
        expect(connectDispatcher).toHaveBeenCalledWith(io, expect.any(String), {
            filter: true,
            clientType: "shell",
        });
    });
});
