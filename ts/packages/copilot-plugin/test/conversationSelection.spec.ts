// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import {
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    rm,
    writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentServerConnection } from "@typeagent/agent-server-client";
import {
    readSelectedConversationId,
    selectConversationId,
} from "../src/shared/conversation-selection.js";
import { createClientIO } from "../src/shared/typeagent-client.js";
import { createStructuredActionClient } from "../src/shared/structured-action-client.js";
import { writeConfig } from "../src/shared/plugin-config.js";

const io = createClientIO({});
const url = `ws://${process.env.TYPEAGENT_HOST || "localhost"}:${process.env.TYPEAGENT_PORT || "8999"}`;

function connection(defaultId: string, resumeToken = "never-persist-this") {
    const searchActions = jest.fn(async () => ({
        protocolVersion: 1,
        scopeId: "scope",
        actions: [],
    }));
    const executeAction = jest.fn(async () => ({ status: "completed" }));
    const joinConversation = jest.fn(
        async (
            _io: unknown,
            options?: {
                conversationId?: string;
                structuredActions?: { resumeToken?: string };
            },
        ) => ({
            conversationId: options?.conversationId ?? defaultId,
            dispatcher: { searchActions, executeAction },
            structuredActions: { resumeToken },
        }),
    );
    const leaveConversation = jest.fn(async () => {});
    const close = jest.fn(async () => {});
    return {
        joinConversation,
        leaveConversation,
        close,
        searchActions,
        executeAction,
        connection: {
            joinConversation,
            leaveConversation,
            close,
        } as unknown as AgentServerConnection,
    };
}

describe("shared conversation selection across routes and processes", () => {
    let directory: string;
    const saved = {
        TYPEAGENT_PLUGIN_DATA: process.env.TYPEAGENT_PLUGIN_DATA,
        TYPEAGENT_CONVERSATION_ID: process.env.TYPEAGENT_CONVERSATION_ID,
        TYPEAGENT_MODE: process.env.TYPEAGENT_MODE,
        COPILOT_AGENT_SESSION_ID: process.env.COPILOT_AGENT_SESSION_ID,
        CLAUDE_PLUGIN_DATA: process.env.CLAUDE_PLUGIN_DATA,
    };
    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), "conversation-selection-"));
        process.env.TYPEAGENT_PLUGIN_DATA = directory;
        process.env.COPILOT_AGENT_SESSION_ID = "session-1";
        delete process.env.TYPEAGENT_CONVERSATION_ID;
        delete process.env.TYPEAGENT_MODE;
    });
    afterEach(async () => {
        await rm(directory, { recursive: true, force: true });
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    it("atomically selects one winner for concurrent callers with different defaults", async () => {
        const first = connection("first");
        const second = connection("second");
        const selected = await Promise.all([
            selectConversationId(first.connection, io, url),
            selectConversationId(second.connection, io, url),
        ]);
        expect(selected[0]).toBe(selected[1]);
        expect(["first", "second"]).toContain(selected[0]);
        const files = await readdir(
            join(directory, "conversation-bindings", "sessions"),
        );
        expect(files).toHaveLength(1);
        expect(
            JSON.parse(
                await readFile(
                    join(
                        directory,
                        "conversation-bindings",
                        "sessions",
                        files[0],
                    ),
                    "utf8",
                ),
            ),
        ).toEqual({ conversationId: selected[0] });
    });

    it("shares the pinned ID across independent hook/MCP-like processes", async () => {
        const moduleUrl = new URL(
            "../shared/conversation-selection.js",
            import.meta.url,
        ).href;
        const child = (id: string) =>
            promisify(execFile)(
                process.execPath,
                [
                    "--input-type=module",
                    "-e",
                    `import { selectConversationId } from ${JSON.stringify(moduleUrl)};
            const connection = {
                joinConversation: async () => ({conversationId: ${JSON.stringify(id)}}),
                leaveConversation: async () => {}
            };
            console.log(await selectConversationId(connection, {}, ${JSON.stringify(url)}));`,
                ],
                { env: { ...process.env }, timeout: 15000 },
            );
        const [first, second] = await Promise.all([
            child("first-process"),
            child("second-process"),
        ]);
        expect(first.stdout.trim()).toBe(second.stdout.trim());
        expect((await child("new-default")).stdout.trim()).toBe(
            first.stdout.trim(),
        );
    });

    it.each(["nl-first", "structured-first"] as const)(
        "%s keeps both routes on the pinned ID after defaults, mode and connections change",
        async (order) => {
            const initial = connection("original");
            const changed = connection("changed-default");
            let disconnect: (() => void) | undefined;
            const client = createStructuredActionClient(
                async (onDisconnect) => {
                    disconnect = onDisconnect;
                    return initial.connection;
                },
            );
            try {
                writeConfig({ mode: "direct" });
                if (order === "nl-first") {
                    await selectConversationId(initial.connection, io, url);
                } else {
                    await client.searchActions({ query: "first" });
                }
                writeConfig({ mode: "mcp", mcpRouting: "delegate" });
                expect(
                    await selectConversationId(changed.connection, io, url),
                ).toBe("original");
                expect(changed.joinConversation).not.toHaveBeenCalled();
                await client.searchActions({ query: "second" });
                disconnect!();
                writeConfig({ mode: "mcp", mcpRouting: "mixed" });
                await client.searchActions({ query: "reconnect" });
                expect(client.binding.conversationId).toBe("original");
                expect(initial.joinConversation).toHaveBeenLastCalledWith(
                    expect.anything(),
                    {
                        conversationId: "original",
                        structuredActions: {
                            resumeToken: "never-persist-this",
                        },
                    },
                );
            } finally {
                await client.close();
            }
        },
    );

    it("fails before effects if explicit context changes under an existing owner", async () => {
        const fake = connection("original");
        const client = createStructuredActionClient(
            async () => fake.connection,
        );
        try {
            await client.searchActions({ query: "first" });
            writeConfig({ mode: "direct", conversationId: "different" });
            await expect(
                client.executeAction({
                    protocolVersion: 1,
                    scopeId: "scope",
                    schemaName: "list",
                    actionName: "listLists",
                    parameters: {},
                }),
            ).rejects.toMatchObject({
                reason: "conversation_changed",
                dispatched: false,
            });
            expect(fake.executeAction).not.toHaveBeenCalled();
            expect(await selectConversationId(fake.connection, io, url)).toBe(
                "different",
            );
        } finally {
            await client.close();
        }
    });

    it("uses environment over config over pinned default without rewriting user settings", async () => {
        const fake = connection("default");
        await selectConversationId(fake.connection, io, url);
        const config = {
            mode: "direct" as const,
            conversationId: "configured",
            selectedSkills: [],
        };
        writeConfig(config);
        expect(await selectConversationId(fake.connection, io, url)).toBe(
            "configured",
        );
        process.env.TYPEAGENT_CONVERSATION_ID = "environment";
        expect(await selectConversationId(fake.connection, io, url)).toBe(
            "environment",
        );
        expect(
            JSON.parse(await readFile(join(directory, "config.json"), "utf8")),
        ).toEqual(config);
        expect(fake.joinConversation).toHaveBeenCalledTimes(1);
    });

    it("keeps server endpoints and plugin data directories separate", async () => {
        expect(
            await selectConversationId(connection("first").connection, io, url),
        ).toBe("first");
        expect(
            await selectConversationId(
                connection("other-server").connection,
                io,
                "ws://other-host:8999",
            ),
        ).toBe("other-server");
        process.env.TYPEAGENT_PLUGIN_DATA = join(directory, "other-config");
        expect(
            await selectConversationId(
                connection("other-config").connection,
                io,
                url,
            ),
        ).toBe("other-config");
    });

    it("does not re-resolve or overwrite a corrupt persisted binding", async () => {
        const fake = connection("first");
        await selectConversationId(fake.connection, io, url);
        const [file] = await readdir(
            join(directory, "conversation-bindings", "sessions"),
        );
        await writeFile(
            join(directory, "conversation-bindings", "sessions", file),
            "{}",
        );
        await expect(
            selectConversationId(fake.connection, io, url),
        ).rejects.toThrow("Invalid TypeAgent conversation binding");
        expect(fake.joinConversation).toHaveBeenCalledTimes(1);
    });

    it("rejects empty explicit IDs instead of falling back to a default", async () => {
        process.env.TYPEAGENT_CONVERSATION_ID = " ";
        await expect(readSelectedConversationId(url)).rejects.toThrow(
            "non-empty string",
        );
    });

    it("resolves fresh sessions independently and preserves each selection on resume", async () => {
        const first = connection("original");
        const second = connection("current-default");
        expect(
            await selectConversationId(first.connection, io, url, "session-1"),
        ).toBe("original");
        expect(
            await selectConversationId(second.connection, io, url, "session-2"),
        ).toBe("current-default");
        expect(
            await selectConversationId(second.connection, io, url, "session-1"),
        ).toBe("original");
        expect(second.joinConversation).toHaveBeenCalledTimes(1);
    });

    it("ignores and preserves the legacy server-only binding, even when corrupt", async () => {
        const legacy = join(
            directory,
            "conversation-bindings",
            `${createHash("sha256").update(new URL(url).href).digest("hex")}.json`,
        );
        await mkdir(join(directory, "conversation-bindings"), {
            recursive: true,
        });
        await writeFile(legacy, "{stale legacy data");
        expect(
            await selectConversationId(
                connection("current-default").connection,
                io,
                url,
            ),
        ).toBe("current-default");
        expect(await readFile(legacy, "utf8")).toBe("{stale legacy data");
    });

    it("uses hook input identity over inherited environment and ignores hook-only storage injection", async () => {
        process.env.COPILOT_AGENT_SESSION_ID = "outer-session";
        process.env.CLAUDE_PLUGIN_DATA = join(directory, "hook-only");
        expect(
            await selectConversationId(
                connection("hook-context").connection,
                io,
                url,
                "inner-session",
            ),
        ).toBe("hook-context");
        delete process.env.CLAUDE_PLUGIN_DATA;
        process.env.COPILOT_AGENT_SESSION_ID = "inner-session";
        const mcp = connection("changed-default");
        expect(await selectConversationId(mcp.connection, io, url)).toBe(
            "hook-context",
        );
        expect(mcp.joinConversation).not.toHaveBeenCalled();
        expect(
            await readSelectedConversationId(url, "outer-session"),
        ).toBeUndefined();
    });

    it("uses process-local automatic context without host identity and writes no binding", async () => {
        delete process.env.COPILOT_AGENT_SESSION_ID;
        const selected = await Promise.all([
            selectConversationId(connection("first").connection, io, url),
            selectConversationId(connection("second").connection, io, url),
        ]);
        expect(selected[0]).toBe(selected[1]);
        expect(
            await selectConversationId(
                connection("changed").connection,
                io,
                url,
            ),
        ).toBe(selected[0]);
        expect(await readdir(directory)).toEqual([]);
    });

    it("shares default storage across hook/MCP processes without hook-only plugin data", async () => {
        const moduleUrl = new URL(
            "../shared/conversation-selection.js",
            import.meta.url,
        ).href;
        const child = async (hook: boolean) => {
            const env: NodeJS.ProcessEnv = {
                ...process.env,
                USERPROFILE: directory,
                HOME: directory,
            };
            delete env.TYPEAGENT_PLUGIN_DATA;
            if (hook)
                env.CLAUDE_PLUGIN_DATA = join(directory, "hook-injected-data");
            else delete env.CLAUDE_PLUGIN_DATA;
            const result = await promisify(execFile)(
                process.execPath,
                [
                    "--input-type=module",
                    "-e",
                    `import { selectConversationId } from ${JSON.stringify(moduleUrl)};
                import { homedir } from "node:os";
                if (homedir() !== ${JSON.stringify(directory)}) throw new Error("Home isolation failed");
                const connection = {
                    joinConversation: async () => ({conversationId: ${JSON.stringify(hook ? "hook-default" : "new-default")}}),
                    leaveConversation: async () => {}
                };
                console.log(await selectConversationId(connection, {}, ${JSON.stringify(url)}));`,
                ],
                { env, timeout: 15000 },
            );
            return result.stdout.trim();
        };
        expect(await child(true)).toBe("hook-default");
        expect(await child(false)).toBe("hook-default");
    });

    it("shares public data but never transfers private owners to a new client in the same session", async () => {
        const first = connection("shared", "owner-one");
        const second = connection("changed-default", "owner-two");
        const a = createStructuredActionClient(async () => first.connection);
        const b = createStructuredActionClient(async () => second.connection);
        try {
            await a.searchActions({ query: "first" });
            await b.searchActions({ query: "second" });
            expect(a.binding.conversationId).toBe("shared");
            expect(b.binding.conversationId).toBe("shared");
            expect(second.joinConversation).toHaveBeenCalledWith(
                expect.anything(),
                {
                    conversationId: "shared",
                    structuredActions: {},
                },
            );
            const [file] = await readdir(
                join(directory, "conversation-bindings", "sessions"),
            );
            expect(
                JSON.parse(
                    await readFile(
                        join(
                            directory,
                            "conversation-bindings",
                            "sessions",
                            file,
                        ),
                        "utf8",
                    ),
                ),
            ).toEqual({ conversationId: "shared" });
        } finally {
            await a.close();
            await b.close();
        }
    });

    it("does not replace a missing automatic selection or dispatch through a fresh owner on reconnect", async () => {
        const fake = connection("original");
        let disconnect: (() => void) | undefined;
        const client = createStructuredActionClient(async (onDisconnect) => {
            disconnect = onDisconnect;
            return fake.connection;
        });
        try {
            await client.searchActions({ query: "first" });
            disconnect!();
            fake.joinConversation.mockRejectedValueOnce(
                new Error("Conversation not found: original"),
            );
            await expect(
                client.searchActions({ query: "after deletion" }),
            ).rejects.toMatchObject({
                dispatched: false,
                reason: "conversation_not_found",
            });
            expect(fake.joinConversation).toHaveBeenCalledTimes(3);
            expect(fake.joinConversation).toHaveBeenLastCalledWith(
                expect.anything(),
                {
                    conversationId: "original",
                    structuredActions: { resumeToken: "never-persist-this" },
                },
            );
            expect(fake.searchActions).toHaveBeenCalledTimes(1);
            expect(await readSelectedConversationId(url)).toBe("original");
        } finally {
            await client.close();
        }
    });

    it.each(["denied", "cancelled", "uncertain"])(
        "does not replay a %s structured execution",
        async (outcome) => {
            const fake = connection("original");
            if (outcome === "uncertain")
                fake.executeAction.mockRejectedValueOnce(
                    new Error("Lost result"),
                );
            else fake.executeAction.mockResolvedValueOnce({ status: outcome });
            const client = createStructuredActionClient(
                async () => fake.connection,
            );
            try {
                const request = client.executeAction({
                    protocolVersion: 1,
                    scopeId: "scope",
                    schemaName: "list",
                    actionName: "listLists",
                    parameters: {},
                });
                if (outcome === "uncertain")
                    await expect(request).rejects.toMatchObject({
                        dispatched: true,
                        reason: "delivery_uncertain",
                    });
                else expect(await request).toEqual({ status: outcome });
                expect(fake.executeAction).toHaveBeenCalledTimes(1);
                expect(fake.joinConversation).toHaveBeenCalledTimes(2);
            } finally {
                await client.close();
            }
        },
    );

    it("does not move an existing structured owner when another session selects a new default", async () => {
        const original = connection("original");
        const client = createStructuredActionClient(
            async () => original.connection,
        );
        try {
            await client.searchActions({ query: "initial" });
            await selectConversationId(
                connection("new-default").connection,
                io,
                url,
                "other-session",
            );
            await client.executeAction({
                protocolVersion: 1,
                scopeId: "scope",
                schemaName: "list",
                actionName: "listLists",
                parameters: {},
            });
            expect(client.binding.conversationId).toBe("original");
            expect(original.executeAction).toHaveBeenCalledTimes(1);
        } finally {
            await client.close();
        }
    });
});
