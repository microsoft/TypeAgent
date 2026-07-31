// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    collectCommandsFromContext,
    collectHostCommands,
} from "../src/commands.js";
import type { CommandInfo } from "../src/types.js";

function collect(node: object): CommandInfo[] {
    const commands: CommandInfo[] = [];
    collectHostCommands("demo", node, commands);
    return commands;
}

describe("collectHostCommands", () => {
    it("emits a bare executable endpoint for a root string default", () => {
        const commands = collect({
            description: "Demo commands",
            defaultSubCommand: "status",
            commands: {
                status: {
                    description: "Show status",
                    action: "showStatus",
                },
            },
        });

        expect(commands.map((command) => command.path)).toEqual(["", "status"]);
        expect(commands[0]).toMatchObject({
            group: true,
            executable: true,
            defaultSubCommand: "status",
            action: { actionName: "showStatus" },
        });
    });

    it("uses an inline default descriptor at the group path", () => {
        const commands = collect({
            description: "Demo commands",
            commands: {
                clear: {
                    description: "Clear output",
                    defaultSubCommand: {
                        description: "Clear output",
                        action: "clearOutput",
                    },
                    commands: {
                        deep: {
                            description: "Clear all state",
                            action: "clearAllState",
                        },
                    },
                },
            },
        });

        expect(commands[0]).toMatchObject({
            path: "clear",
            group: true,
            executable: true,
            action: { actionName: "clearOutput" },
        });
        expect(commands[1]).toMatchObject({
            path: "clear deep",
            group: false,
            executable: true,
        });
    });

    it("keeps a group without a default as a namespace", () => {
        const commands = collect({
            description: "Demo commands",
            commands: {
                admin: {
                    description: "Administrative commands",
                    commands: {
                        show: { description: "Show configuration" },
                    },
                },
            },
        });

        expect(commands[0]).toMatchObject({
            path: "admin",
            group: true,
            executable: false,
        });
        expect(commands[1].executable).toBe(true);
    });

    it("does not treat a string default that targets a table as executable", () => {
        const commands = collect({
            description: "Demo commands",
            defaultSubCommand: "admin",
            commands: {
                admin: {
                    description: "Administrative commands",
                    commands: {
                        show: { description: "Show configuration" },
                    },
                },
            },
        });

        expect(commands.some((command) => command.path === "")).toBe(false);
        expect(commands[0]).toMatchObject({
            path: "admin",
            group: true,
            executable: false,
        });
    });

    it("emits a bare descriptor as an executable endpoint", () => {
        const commands = collect({
            description: "Run demo",
            action: "runDemo",
        });

        expect(commands).toEqual([
            expect.objectContaining({
                path: "",
                group: false,
                executable: true,
                action: { actionName: "runDemo" },
            }),
        ]);
    });
});

describe("collectCommandsFromContext", () => {
    function makeFailingContext() {
        return {
            agents: {
                getAppAgentNames: () => ["demo"],
                isCommandEnabled: () => true,
                getAppAgent: () => ({
                    getCommands: async () => {
                        throw new Error("command table failed");
                    },
                }),
                getSessionContext: () => ({}),
            },
        } as any;
    }

    it("throws with the host name in strict mode", async () => {
        await expect(
            collectCommandsFromContext(makeFailingContext(), true),
        ).rejects.toThrow(
            'Failed to collect commands for host "demo": command table failed',
        );
    });

    it("keeps best-effort generation behavior outside strict mode", async () => {
        await expect(
            collectCommandsFromContext(makeFailingContext(), false),
        ).resolves.toEqual([]);
    });
});
