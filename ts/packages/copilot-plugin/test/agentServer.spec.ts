// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ClientIO, Dispatcher } from "@typeagent/agent-server-client";
import type {
    AgentSchemaInfo,
    CommandResult,
    DispatcherStatus,
} from "@typeagent/dispatcher-types";
import { TypeAgentToolAdapter } from "../src/mcp/agentServer.js";
import type { AgentToolDependencies } from "../src/mcp/agentServer.js";

const playerSchemas: AgentSchemaInfo[] = [
    {
        name: "player",
        emoji: "🎵",
        description: "Play music",
        subSchemas: [
            {
                schemaName: "player",
                description: "Playback control",
                schemaText: "export type PlayAction = { actionName: 'play' };",
                actions: [{ name: "play", description: "Play a track" }],
            },
            {
                schemaName: "player.playlist",
                description: "Playlist management",
                schemaText: undefined,
                actions: [
                    { name: "createPlaylist", description: "Make a playlist" },
                ],
            },
        ],
    },
];

function agentStatus(name: string, active: boolean) {
    return {
        emoji: "🎵",
        name,
        lastUsed: false,
        priority: false,
        request: true,
        active,
        actionActive: active,
    };
}

const status: DispatcherStatus = {
    agents: [
        agentStatus("player", true),
        agentStatus("player.playlist", false),
    ],
    details: "",
};

type FakeDispatcher = {
    dispatcher: Dispatcher;
    commands: string[];
    close: jest.Mock;
    cancelCommand: jest.Mock;
};

function fakeDispatcher(options?: {
    schemas?: AgentSchemaInfo[];
    status?: DispatcherStatus;
    result?: CommandResult;
    onSubmit?: (clientIO: ClientIO) => void;
    clientIO?: ClientIO;
}): FakeDispatcher {
    const commands: string[] = [];
    const close = jest.fn(async () => {});
    const cancelCommand = jest.fn(async () => ({
        kind: "cancelled_running" as const,
        requestId: "request-1",
    }));
    const dispatcher = {
        getAgentSchemas: jest.fn(async () => options?.schemas ?? playerSchemas),
        getStatus: jest.fn(async () => options?.status ?? status),
        submitCommand: jest.fn(async (command: string) => {
            commands.push(command);
            if (options?.clientIO) {
                options.onSubmit?.(options.clientIO);
            }
            return {
                ok: true as const,
                entry: {
                    requestId: "request-1",
                    completion: Promise.resolve(options?.result),
                },
            };
        }),
        cancelCommand,
        cancelCommandByClientId: jest.fn(),
        close,
    } as unknown as Dispatcher;
    return { dispatcher, commands, close, cancelCommand };
}

function makeAdapter(
    fake: FakeDispatcher,
    overrides: Partial<AgentToolDependencies> = {},
): { adapter: TypeAgentToolAdapter; capture: { clientIO?: ClientIO } } {
    const capture: { clientIO?: ClientIO } = {};
    const adapter = new TypeAgentToolAdapter({
        connect: async (clientIO: ClientIO) => {
            capture.clientIO = clientIO;
            return fake.dispatcher;
        },
        getMode: () => "mcp",
        log: () => {},
        ...overrides,
    });
    return { adapter, capture };
}

function textOf(result: CallToolResult): string {
    return result.content
        .map((entry) => ("text" in entry ? String(entry.text) : ""))
        .join("\n");
}

describe("TypeAgent action discovery", () => {
    it("lists the agents that have enabled actions", async () => {
        const fake = fakeDispatcher();
        const { adapter } = makeAdapter(fake);

        const result = await adapter.discoverActions({});

        expect(result.isError).toBeUndefined();
        expect(textOf(result)).toContain("player");
        expect(fake.close).toHaveBeenCalledTimes(1);
    });

    it("hides actions from sub-schemas the session disabled", async () => {
        const fake = fakeDispatcher();
        const { adapter } = makeAdapter(fake);

        const result = await adapter.discoverActions({ agentName: "player" });

        const text = textOf(result);
        expect(text).toContain("play");
        expect(text).not.toContain("createPlaylist");
    });

    it("returns the TypeScript contract for one action", async () => {
        const fake = fakeDispatcher();
        const { adapter } = makeAdapter(fake);

        const result = await adapter.discoverActions({
            agentName: "player",
            actionName: "play",
        });

        expect(result.isError).toBeUndefined();
        expect(textOf(result)).toContain("export type PlayAction");
    });

    it("reports enabled alternatives for an unknown action", async () => {
        const fake = fakeDispatcher();
        const { adapter } = makeAdapter(fake);

        const result = await adapter.discoverActions({
            agentName: "player",
            actionName: "createPlaylist",
        });

        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("play");
    });

    it("is disabled in dev and bypass mode without connecting", async () => {
        const connect = jest.fn(async () => fakeDispatcher().dispatcher);
        const adapter = new TypeAgentToolAdapter({
            connect: connect as unknown as AgentToolDependencies["connect"],
            getMode: () => "bypass",
            log: () => {},
        });

        const result = await adapter.discoverActions({});

        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("bypass");
        expect(connect).not.toHaveBeenCalled();
    });
});

describe("TypeAgent direct action execution", () => {
    it("dispatches @action instead of natural language", async () => {
        const fake = fakeDispatcher();
        const { adapter } = makeAdapter(fake);

        const result = await adapter.executeAction({
            schemaName: "player",
            actionName: "play",
            parameters: { track: "Yesterday" },
        });

        expect(result.isError).toBeUndefined();
        expect(fake.commands).toEqual([
            `@action player play --parameters '{"track":"Yesterday"}'`,
        ]);
        expect(fake.close).toHaveBeenCalledTimes(1);
    });

    it("passes the original phrasing through for cache seeding only", async () => {
        const fake = fakeDispatcher();
        const { adapter } = makeAdapter(fake);

        await adapter.executeAction({
            schemaName: "player",
            actionName: "play",
            naturalLanguage: "play yesterday",
        });

        expect(fake.commands[0]).toBe(
            `@action player play --naturalLanguage 'play yesterday'`,
        );
    });

    it("rejects a schema name that could inject extra command tokens", async () => {
        const fake = fakeDispatcher();
        const { adapter } = makeAdapter(fake);

        const result = await adapter.executeAction({
            schemaName: "player --flag",
            actionName: "play",
        });

        expect(result.isError).toBe(true);
        expect(fake.commands).toEqual([]);
    });

    it("reports a dispatcher action error as a tool error", async () => {
        const fake = fakeDispatcher({ result: { lastError: "no such track" } });
        const { adapter } = makeAdapter(fake);

        const result = await adapter.executeAction({
            schemaName: "player",
            actionName: "play",
        });

        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("no such track");
    });

    it("forwards an agent's structured payload to the MCP client", async () => {
        const fake = fakeDispatcher();
        const captured: { clientIO?: ClientIO } = {};
        const adapter = new TypeAgentToolAdapter({
            connect: async (clientIO: ClientIO) => {
                captured.clientIO = clientIO;
                return fake.dispatcher;
            },
            getMode: () => "mcp",
            log: () => {},
        });
        (fake.dispatcher.submitCommand as jest.Mock).mockImplementation(
            async () => {
                captured.clientIO?.setDisplay({
                    message: {
                        type: "structured",
                        blocks: [],
                        rawData: { tracks: ["Yesterday"] },
                        alternates: [{ type: "text", content: "1 track" }],
                    },
                } as never);
                return {
                    ok: true as const,
                    entry: {
                        requestId: "request-1",
                        completion: Promise.resolve(undefined),
                    },
                };
            },
        );

        const result = await adapter.executeAction({
            schemaName: "player",
            actionName: "play",
        });

        expect(result.structuredContent).toEqual({ tracks: ["Yesterday"] });
    });

    it("cancels the dispatcher request when the tool call is aborted", async () => {
        const fake = fakeDispatcher();
        const { adapter } = makeAdapter(fake);
        const controller = new AbortController();
        let completed: (value: CommandResult | undefined) => void = () => {};
        const completion = new Promise<CommandResult | undefined>((resolve) => {
            completed = resolve;
        });
        let submitted: () => void = () => {};
        const submittedSignal = new Promise<void>((resolve) => {
            submitted = resolve;
        });
        (fake.dispatcher.submitCommand as jest.Mock).mockImplementation(
            async () => {
                submitted();
                return {
                    ok: true as const,
                    entry: { requestId: "request-1", completion },
                };
            },
        );

        const pending = adapter.executeAction(
            { schemaName: "player", actionName: "play" },
            {
                sendNotification: async () => {},
                signal: controller.signal,
            },
        );
        await submittedSignal;
        controller.abort();
        completed({ cancelled: true });

        const result = await pending;
        expect(fake.cancelCommand).toHaveBeenCalledWith("request-1");
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("cancelled");
    });

    it("never submits an action for a tool call that was already aborted", async () => {
        const fake = fakeDispatcher();
        const { adapter } = makeAdapter(fake);
        const controller = new AbortController();
        controller.abort();

        const result = await adapter.executeAction(
            { schemaName: "player", actionName: "play" },
            { sendNotification: async () => {}, signal: controller.signal },
        );

        expect(fake.dispatcher.submitCommand).not.toHaveBeenCalled();
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("cancelled");
    });

    it("labels output produced before a cancellation", async () => {
        const fake = fakeDispatcher({ result: { cancelled: true } });
        const { adapter, capture } = makeAdapter(fake);
        (fake.dispatcher.submitCommand as jest.Mock).mockImplementation(
            async () => {
                capture.clientIO?.setDisplay({
                    message: "started queuing tracks",
                } as never);
                return {
                    ok: true as const,
                    entry: {
                        requestId: "request-1",
                        completion: Promise.resolve({ cancelled: true }),
                    },
                };
            },
        );

        const result = await adapter.executeAction({
            schemaName: "player",
            actionName: "play",
        });

        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("was cancelled");
        expect(textOf(result)).toContain("started queuing tracks");
    });

    it("reports a prompt it cannot answer instead of claiming success", async () => {
        const fake = fakeDispatcher();
        const { adapter, capture } = makeAdapter(fake);
        (fake.dispatcher.submitCommand as jest.Mock).mockImplementation(
            async () => {
                capture.clientIO?.requestChoice(
                    { requestId: "request-1" },
                    "choice-1",
                    "yesNo",
                    "Delete the shopping list?",
                    ["Yes", "No"],
                    "list",
                );
                return {
                    ok: true as const,
                    entry: {
                        requestId: "request-1",
                        completion: Promise.resolve(undefined),
                    },
                };
            },
        );

        const result = await adapter.executeAction({
            schemaName: "list",
            actionName: "deleteList",
        });

        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("Delete the shopping list?");
        expect(textOf(result)).toContain("did not complete");
    });

    it("is disabled in dev mode without connecting", async () => {
        const connect = jest.fn(async () => fakeDispatcher().dispatcher);
        const adapter = new TypeAgentToolAdapter({
            connect: connect as unknown as AgentToolDependencies["connect"],
            getMode: () => "dev",
            log: () => {},
        });

        const result = await adapter.executeAction({
            schemaName: "player",
            actionName: "play",
        });

        expect(result.isError).toBe(true);
        expect(connect).not.toHaveBeenCalled();
    });
});

describe("TypeAgent processCommand", () => {
    it("still sends the request unchanged for translation", async () => {
        const fake = fakeDispatcher();
        const { adapter } = makeAdapter(fake);

        const result = await adapter.processCommand("learn: play yesterday");

        expect(result.isError).toBeUndefined();
        expect(fake.commands).toEqual(["learn: play yesterday"]);
        expect(textOf(result)).toContain("learn: play yesterday");
    });

    it("returns dispatcher errors as text, not tool errors", async () => {
        const fake = fakeDispatcher({ result: { lastError: "boom" } });
        const { adapter } = makeAdapter(fake);

        const result = await adapter.processCommand("play yesterday");

        expect(result.isError).toBeUndefined();
        expect(textOf(result)).toContain("boom");
    });

    it("stays disabled in bypass mode", async () => {
        const connect = jest.fn(async () => fakeDispatcher().dispatcher);
        const adapter = new TypeAgentToolAdapter({
            connect: connect as unknown as AgentToolDependencies["connect"],
            getMode: () => "bypass",
            log: () => {},
        });

        const result = await adapter.processCommand("play yesterday");

        expect(result.isError).toBe(true);
        expect(connect).not.toHaveBeenCalled();
    });
});
