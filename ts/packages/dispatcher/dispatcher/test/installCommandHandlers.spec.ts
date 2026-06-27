// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, it, expect, jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
    getSourceCommandHandlers,
} from "../src/context/system/handlers/installCommandHandlers.js";
import type { CommandHandlerContext } from "../src/context/commandHandlerContext.js";

// Minimal fakes: the validation / --where / uninstall branches never reach the
// heavy installAppProvider(addProvider) path, so a light context suffices.

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

// Like fakeActionContext but captures every appendDisplay payload as text so
// tests can assert rendered output. displayResult appends a raw string;
// displayWarn appends a { content } object.
function capturingContext(systemContext: any): {
    context: ActionContext<CommandHandlerContext>;
    output: () => string;
} {
    const captured: string[] = [];
    const context = {
        sessionContext: { agentContext: systemContext },
        actionIO: {
            appendDisplay: (content: any) => {
                captured.push(
                    typeof content === "string"
                        ? content
                        : (content?.content ?? JSON.stringify(content)),
                );
            },
            setDisplay: () => {},
            takeAction: () => {},
        },
    } as any;
    return { context, output: () => captured.join("\n") };
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
    flags: { source?: string; where?: boolean } = {},
): any {
    return {
        args: { name, ref },
        flags: { source: flags.source, where: flags.where ?? false },
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

    it("--where reports the winning source without installing", async () => {
        const install = jest.fn();
        const where = jest.fn(async () => ({
            source: "path",
            path: "/some/path",
        }));
        const systemContext = makeSystemContext({
            agentInstaller: {
                install,
                uninstall: jest.fn(),
                sources: () => ({ where, order: () => [] }),
            },
        });
        await handler.run(
            fakeActionContext(systemContext),
            installParams("foo", "/some/path", { where: true }),
        );
        expect(where).toHaveBeenCalledWith("/some/path");
        expect(install).not.toHaveBeenCalled();
    });

    it("--where throws when the installer has no source registry", async () => {
        const systemContext = makeSystemContext({
            agentInstaller: { install: jest.fn(), uninstall: jest.fn() },
        });
        await expect(
            handler.run(
                fakeActionContext(systemContext),
                installParams("foo", "/some/path", { where: true }),
            ),
        ).rejects.toThrow(/sources are not available/i);
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

// A fake registry covering the surface the @source handlers touch.
function makeRegistry(overrides: any = {}) {
    const configs = overrides.configs ?? [{ kind: "path", name: "path" }];
    const orderNames = overrides.order ?? configs.map((c: any) => c.name);
    return {
        list: jest.fn(() => configs),
        order: jest.fn(() =>
            orderNames.map((name: string) => ({ name, kind: "path" })),
        ),
        setOrder: jest.fn(),
        add: jest.fn(),
        remove: jest.fn(),
        get: jest.fn(),
        resolve: jest.fn(),
        where: jest.fn(),
    };
}

function sourceContext(registry: any, recordsUsingSource?: any) {
    return makeSystemContext({
        agentInstaller: {
            install: jest.fn(),
            uninstall: jest.fn(),
            sources: () => registry,
            recordsUsingSource: recordsUsingSource ?? (() => [] as string[]),
        },
    });
}

describe("@source command handlers", () => {
    const table = getSourceCommandHandlers();
    const list = table.commands.list as any;
    const order = table.commands.order as any;
    const add = (table.commands.add as any).commands;
    const remove = table.commands.remove as any;

    it("list reports the order and configured sources", async () => {
        const registry = makeRegistry();
        await list.run(fakeActionContext(sourceContext(registry)));
        expect(registry.list).toHaveBeenCalled();
        expect(registry.order).toHaveBeenCalled();
    });

    it("list renders the order and each source with its position", async () => {
        const registry = makeRegistry({
            configs: [
                { kind: "path", name: "path" },
                {
                    kind: "feed",
                    name: "typeagent",
                    registry: "https://feed.example.com/",
                    scopes: [],
                },
            ],
            order: ["path", "typeagent"],
        });
        const { context, output } = capturingContext(sourceContext(registry));
        await list.run(context);
        const text = output();
        expect(text).toContain("Resolution order: [path, typeagent]");
        expect(text).toContain("path [path] #1");
        expect(text).toContain("typeagent [feed] #2 https://feed.example.com/");
    });

    it("order keeps the requested subset first and appends the rest", async () => {
        const registry = makeRegistry({
            configs: [
                { kind: "path", name: "path" },
                { kind: "catalog", name: "builtin", catalog: "<bundled>" },
            ],
            order: ["path", "builtin"],
        });
        await order.run(fakeActionContext(sourceContext(registry)), {
            args: { names: ["builtin"] },
        });
        expect(registry.setOrder).toHaveBeenCalledWith(["builtin", "path"]);
    });

    it("order warns on and skips an unknown source name", async () => {
        const registry = makeRegistry();
        await order.run(fakeActionContext(sourceContext(registry)), {
            args: { names: ["nope", "path"] },
        });
        expect(registry.setOrder).toHaveBeenCalledWith(["path"]);
    });

    it("order deduplicates repeated source names", async () => {
        const registry = makeRegistry({
            configs: [
                { kind: "path", name: "path" },
                { kind: "catalog", name: "builtin", catalog: "<bundled>" },
            ],
            order: ["path", "builtin"],
        });
        await order.run(fakeActionContext(sourceContext(registry)), {
            args: { names: ["builtin", "builtin", "path"] },
        });
        expect(registry.setOrder).toHaveBeenCalledWith(["builtin", "path"]);
    });

    it("order with no names leaves the configured set intact", async () => {
        const registry = makeRegistry({
            configs: [
                { kind: "path", name: "path" },
                { kind: "catalog", name: "builtin", catalog: "<bundled>" },
            ],
            order: ["path", "builtin"],
        });
        await order.run(fakeActionContext(sourceContext(registry)), {
            args: { names: [] },
        });
        expect(registry.setOrder).toHaveBeenCalledWith(["path", "builtin"]);
    });

    it("add feed requires a registry url", async () => {
        const registry = makeRegistry();
        await expect(
            add.feed.run(fakeActionContext(sourceContext(registry)), {
                args: { name: "f" },
                flags: { registry: undefined, scope: undefined },
            }),
        ).rejects.toThrow(/--registry/);
        expect(registry.add).not.toHaveBeenCalled();
    });

    it("add feed rejects a non-https url", async () => {
        const registry = makeRegistry();
        await expect(
            add.feed.run(fakeActionContext(sourceContext(registry)), {
                args: { name: "f" },
                flags: {
                    registry: "http://example.com/feed",
                    scope: undefined,
                },
            }),
        ).rejects.toThrow(/https/);
    });

    it("add feed registers a well-formed feed source", async () => {
        const registry = makeRegistry();
        await add.feed.run(fakeActionContext(sourceContext(registry)), {
            args: { name: "f" },
            flags: {
                registry: "https://pkgs.example.com/feed/",
                scope: ["@scope"],
            },
        });
        expect(registry.add).toHaveBeenCalledWith({
            kind: "feed",
            name: "f",
            registry: "https://pkgs.example.com/feed/",
            scopes: ["@scope"],
        });
    });

    it("add path registers a path source with an optional baseDir", async () => {
        const registry = makeRegistry();
        await add.path.run(fakeActionContext(sourceContext(registry)), {
            args: { name: "local" },
            flags: { baseDir: "/agents" },
        });
        expect(registry.add).toHaveBeenCalledWith({
            kind: "path",
            name: "local",
            baseDir: "/agents",
        });
    });

    it("add catalog requires a catalog path", async () => {
        const registry = makeRegistry();
        await expect(
            add.catalog.run(fakeActionContext(sourceContext(registry)), {
                args: { name: "c" },
                flags: { catalog: undefined },
            }),
        ).rejects.toThrow(/--catalog/);
        expect(registry.add).not.toHaveBeenCalled();
    });

    it("add catalog registers a source for a readable JSON file", async () => {
        const registry = makeRegistry();
        const file = path.join(
            fs.mkdtempSync(path.join(os.tmpdir(), "ta-cat-")),
            "catalog.json",
        );
        fs.writeFileSync(file, JSON.stringify({ agents: {} }));
        await add.catalog.run(fakeActionContext(sourceContext(registry)), {
            args: { name: "c" },
            flags: { catalog: file },
        });
        expect(registry.add).toHaveBeenCalledWith({
            kind: "catalog",
            name: "c",
            catalog: file,
        });
    });

    it("add catalog reports an inaccessible file distinctly from bad JSON", async () => {
        const registry = makeRegistry();
        const missing = path.join(os.tmpdir(), "ta-no-such-catalog-xyz.json");
        await expect(
            add.catalog.run(fakeActionContext(sourceContext(registry)), {
                args: { name: "c" },
                flags: { catalog: missing },
            }),
        ).rejects.toThrow(/not accessible/);
        expect(registry.add).not.toHaveBeenCalled();
    });

    it("add catalog rejects a file that is not valid JSON", async () => {
        const registry = makeRegistry();
        const file = path.join(
            fs.mkdtempSync(path.join(os.tmpdir(), "ta-cat-")),
            "catalog.json",
        );
        fs.writeFileSync(file, "{ not json");
        await expect(
            add.catalog.run(fakeActionContext(sourceContext(registry)), {
                args: { name: "c" },
                flags: { catalog: file },
            }),
        ).rejects.toThrow(/not valid JSON/);
        expect(registry.add).not.toHaveBeenCalled();
    });

    it("remove warns and aborts when a source is still referenced", async () => {
        const registry = makeRegistry();
        const ctx = sourceContext(registry, () => ["a", "b"]);
        await remove.run(fakeActionContext(ctx), {
            args: { name: "path" },
            flags: { force: false },
        });
        expect(registry.remove).not.toHaveBeenCalled();
    });

    it("remove proceeds with --force despite references", async () => {
        const registry = makeRegistry();
        const ctx = sourceContext(registry, () => ["a"]);
        await remove.run(fakeActionContext(ctx), {
            args: { name: "path" },
            flags: { force: true },
        });
        expect(registry.remove).toHaveBeenCalledWith("path");
    });

    it("remove proceeds when nothing references the source", async () => {
        const registry = makeRegistry();
        const ctx = sourceContext(registry, () => []);
        await remove.run(fakeActionContext(ctx), {
            args: { name: "path" },
            flags: { force: false },
        });
        expect(registry.remove).toHaveBeenCalledWith("path");
    });

    it("throws when the installer exposes no registry", async () => {
        const systemContext = makeSystemContext({
            agentInstaller: { install: jest.fn(), uninstall: jest.fn() },
        });
        await expect(
            list.run(fakeActionContext(systemContext)),
        ).rejects.toThrow(/sources are not available/i);
    });
});
