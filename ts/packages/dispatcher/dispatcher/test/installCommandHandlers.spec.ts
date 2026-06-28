// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, it, expect, jest } from "@jest/globals";
import { ActionContext } from "@typeagent/agent-sdk";
// Force the commandHandlerContext module graph (which includes systemAgent's
// top-level `new InstallCommandHandler()`) to evaluate first, so importing the
// handler module directly below does not trip the install<->systemAgent module
// cycle (TDZ) that only surfaces when the handler is the entry module.
import "../src/context/commandHandlerContext.js";
import {
    InstallCommandHandler,
    UninstallCommandHandler,
    UpdateCommandHandler,
} from "../src/context/system/handlers/installCommandHandlers.js";
import type { CommandHandlerContext } from "../src/context/commandHandlerContext.js";

// Minimal fakes: the validation / uninstall branches never reach the heavy
// installAppProvider(addProvider) path, so a light context suffices.

function fakeActionContext(
    systemContext: any,
): ActionContext<CommandHandlerContext> {
    return {
        sessionContext: { agentContext: systemContext },
        actionIO: {
            appendDisplay: () => {},
            setDisplay: () => {},
            takeAction: () => {},
        },
    } as any;
}

function makeSystemContext(overrides: any = {}) {
    return {
        agentInstaller: overrides.agentInstaller,
        agents: {
            isAppAgentName: overrides.isAppAgentName ?? (() => false),
            removeAgent: overrides.removeAgent ?? (async () => {}),
        },
        agentCache: { grammarStore: {} },
    };
}

function installParams(
    name: string,
    ref: string,
    flags: { source?: string } = {},
): any {
    return {
        args: { name, ref },
        flags: { source: flags.source },
    };
}

describe("InstallCommandHandler", () => {
    const handler = new InstallCommandHandler();

    it("throws when no installer is available", async () => {
        const systemContext = makeSystemContext({ agentInstaller: undefined });
        await expect(
            handler.run(
                fakeActionContext(systemContext),
                installParams("foo", "/some/path"),
            ),
        ).rejects.toThrow(/installer not available/i);
    });

    it("rejects an illegal agent name before calling install", async () => {
        const install = jest.fn();
        const systemContext = makeSystemContext({
            agentInstaller: { install, uninstall: jest.fn() },
        });
        await expect(
            handler.run(
                fakeActionContext(systemContext),
                installParams("bad name!", "/some/path"),
            ),
        ).rejects.toThrow(/not a legal agent name/i);
        expect(install).not.toHaveBeenCalled();
    });

    it("rejects a name already used by any provider before calling install (Q18)", async () => {
        const install = jest.fn();
        const systemContext = makeSystemContext({
            agentInstaller: { install, uninstall: jest.fn() },
            isAppAgentName: (n: string) => n === "taken",
        });
        await expect(
            handler.run(
                fakeActionContext(systemContext),
                installParams("taken", "/some/path"),
            ),
        ).rejects.toThrow(/already exists/i);
        expect(install).not.toHaveBeenCalled();
    });
});

describe("UninstallCommandHandler", () => {
    const handler = new UninstallCommandHandler();

    it("calls installer.uninstall then removeAgent on the live session", async () => {
        const uninstall = jest.fn(async () => {});
        const removeAgent = jest.fn(async () => {});
        const systemContext = makeSystemContext({
            agentInstaller: { install: jest.fn(), uninstall },
            removeAgent,
        });
        await handler.run(fakeActionContext(systemContext), {
            args: { name: "gone" },
        } as any);
        expect(uninstall).toHaveBeenCalledWith("gone");
        expect(removeAgent).toHaveBeenCalledWith("gone", expect.anything());
        // teardown follows the record drop
        expect(uninstall.mock.invocationCallOrder[0]).toBeLessThan(
            removeAgent.mock.invocationCallOrder[0],
        );
    });

    it("throws when no installer is available", async () => {
        const systemContext = makeSystemContext({ agentInstaller: undefined });
        await expect(
            handler.run(fakeActionContext(systemContext), {
                args: { name: "gone" },
            } as any),
        ).rejects.toThrow(/installer not available/i);
    });
});

describe("UpdateCommandHandler", () => {
    const handler = new UpdateCommandHandler();

    it("throws when no installer is available", async () => {
        const systemContext = makeSystemContext({ agentInstaller: undefined });
        await expect(
            handler.run(fakeActionContext(systemContext), {
                args: { name: "a" },
            } as any),
        ).rejects.toThrow(/installer not available/i);
    });

    it("throws when the installer does not support update", async () => {
        const systemContext = makeSystemContext({
            agentInstaller: { install: jest.fn(), uninstall: jest.fn() },
        });
        await expect(
            handler.run(fakeActionContext(systemContext), {
                args: { name: "a" },
            } as any),
        ).rejects.toThrow(/not supported/i);
    });
});

