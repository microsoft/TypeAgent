// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgentProvider } from "agent-dispatcher";
import {
    buildPackageCommandTable,
    createPackageAppAgentProvider,
    InstalledAgentSourceApi,
    PackageAgentContext,
    PACKAGE_AGENT_NAME,
} from "../src/installSources/packageAgent.js";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";

function fakeProvider(name: string): AppAgentProvider {
    return {
        getAppAgentNames: () => [name],
        getAppAgentManifest: async () => ({}) as any,
        loadAppAgent: async () => ({}) as any,
        unloadAppAgent: async () => {},
    };
}

type HostCall =
    | { op: "add"; name: string; enable: boolean }
    | { op: "remove"; name: string };

function fakeHost() {
    const calls: HostCall[] = [];
    return {
        calls,
        host: {
            addProvider: async (p: AppAgentProvider, enable: boolean) => {
                calls.push({
                    op: "add",
                    name: p.getAppAgentNames()[0],
                    enable,
                });
            },
            removeProvider: async (p: AppAgentProvider) => {
                calls.push({ op: "remove", name: p.getAppAgentNames()[0] });
            },
        },
    };
}

// A source stub recording calls; each op returns provider(s) by name.
function fakeSource(
    overrides: Partial<InstalledAgentSourceApi> = {},
): InstalledAgentSourceApi {
    return {
        install: async (name: string) => ({
            provider: fakeProvider(name),
            source: "path",
        }),
        uninstall: async (name: string) => ({ provider: fakeProvider(name) }),
        update: async (name: string) => ({
            oldProvider: fakeProvider(name),
            newProvider: fakeProvider(name),
        }),
        listInstalled: () => [],
        listSources: () => [],
        listAvailable: async () => [],
        sourceCommands: () => ({
            description: "sources",
            commands: {},
        }),
        ...overrides,
    };
}

function fakeActionContext(agentContext: PackageAgentContext) {
    return {
        sessionContext: { agentContext },
        actionIO: {
            appendDisplay: () => {},
            setDisplay: () => {},
            takeAction: () => {},
        },
    } as any;
}

function getHandler(
    source: InstalledAgentSourceApi,
    name: "install" | "uninstall" | "update",
): CommandHandler {
    const table = buildPackageCommandTable(source.sourceCommands());
    return table.commands[name] as CommandHandler;
}

describe("@package agent", () => {
    it("vends a command-only agent named 'package' with the host-owned context", async () => {
        const { host } = fakeHost();
        const ctx: PackageAgentContext = {
            appAgentHost: host,
            source: fakeSource(),
        };
        const provider = createPackageAppAgentProvider(ctx);
        expect(provider.getAppAgentNames()).toEqual([PACKAGE_AGENT_NAME]);

        const agent = await provider.loadAppAgent(PACKAGE_AGENT_NAME);
        // The agentContext is the host-owned PackageAgentContext — never a
        // dispatcher CommandHandlerContext (design §3.4).
        const agentContext = await agent.initializeAgentContext!();
        expect(agentContext).toBe(ctx);
        expect(typeof agent.getCommands).toBe("function");

        const manifest = await provider.getAppAgentManifest(PACKAGE_AGENT_NAME);
        expect(manifest.commandDefaultEnabled).toBe(true);
        expect(manifest.schema).toBeUndefined();
    });

    it("install registers the resolved provider into the issuing session (enable=true)", async () => {
        const { host, calls } = fakeHost();
        let installedRef: string | undefined;
        const source = fakeSource({
            install: async (name: string, ref: string) => {
                installedRef = ref;
                return { provider: fakeProvider(name), source: "path" };
            },
        });
        const handler = getHandler(source, "install");
        await handler.run(fakeActionContext({ appAgentHost: host, source }), {
            args: { name: "foo", ref: "/some/path" },
            flags: {},
        } as any);
        expect(installedRef).toBe("/some/path");
        expect(calls).toEqual([{ op: "add", name: "foo", enable: true }]);
    });

    it("install rejects an illegal name before touching the source", async () => {
        const { host } = fakeHost();
        let called = false;
        const source = fakeSource({
            install: async (name: string) => {
                called = true;
                return { provider: fakeProvider(name), source: "path" };
            },
        });
        const handler = getHandler(source, "install");
        await expect(
            handler.run(fakeActionContext({ appAgentHost: host, source }), {
                args: { name: "bad name!", ref: "/x" },
                flags: {},
            } as any),
        ).rejects.toThrow(/not a legal agent name/i);
        expect(called).toBe(false);
    });

    it("uninstall tears down the live provider in the issuing session", async () => {
        const { host, calls } = fakeHost();
        const source = fakeSource();
        const handler = getHandler(source, "uninstall");
        await handler.run(fakeActionContext({ appAgentHost: host, source }), {
            args: { name: "foo" },
        } as any);
        expect(calls).toEqual([{ op: "remove", name: "foo" }]);
    });

    it("update removes-then-adds in the issuing session (FIFO)", async () => {
        const { host, calls } = fakeHost();
        const source = fakeSource();
        const handler = getHandler(source, "update");
        await handler.run(fakeActionContext({ appAgentHost: host, source }), {
            args: { name: "foo" },
        } as any);
        expect(calls).toEqual([
            { op: "remove", name: "foo" },
            { op: "add", name: "foo", enable: true },
        ]);
    });
});

describe("@package command table", () => {
    it("nests the host @source table under `source` and defaults to list", () => {
        const sourceTable = {
            description: "sources",
            commands: { add: { description: "add" }, list: {} },
        };
        const table = buildPackageCommandTable(sourceTable as any);
        expect(Object.keys(table.commands).sort()).toEqual([
            "install",
            "list",
            "source",
            "uninstall",
            "update",
        ]);
        // `@package source` points at the exact host-provided table instance.
        expect(table.commands.source).toBe(sourceTable);
        expect(table.defaultSubCommand).toBe("list");
    });
});

describe("@package handler error handling", () => {
    it("install failure does not register anything (no partial add)", async () => {
        const { host, calls } = fakeHost();
        const source = fakeSource({
            install: async () => {
                throw new Error("resolution failed");
            },
        });
        const handler = getHandler(source, "install");
        await expect(
            handler.run(fakeActionContext({ appAgentHost: host, source }), {
                args: { name: "foo", ref: "bad" },
                flags: {},
            } as any),
        ).rejects.toThrow(/resolution failed/);
        expect(calls).toEqual([]);
    });

    it("uninstall failure does not remove anything", async () => {
        const { host, calls } = fakeHost();
        const source = fakeSource({
            uninstall: async () => {
                throw new Error("not found");
            },
        });
        const handler = getHandler(source, "uninstall");
        await expect(
            handler.run(fakeActionContext({ appAgentHost: host, source }), {
                args: { name: "missing" },
            } as any),
        ).rejects.toThrow(/not found/);
        expect(calls).toEqual([]);
    });

    it("update failure (materialize) does not touch the live session", async () => {
        const { host, calls } = fakeHost();
        const source = fakeSource({
            update: async () => {
                throw new Error("source no longer configured");
            },
        });
        const handler = getHandler(source, "update");
        await expect(
            handler.run(fakeActionContext({ appAgentHost: host, source }), {
                args: { name: "foo" },
            } as any),
        ).rejects.toThrow(/no longer configured/);
        expect(calls).toEqual([]);
    });
});

function fakeSessionContext(agentContext: PackageAgentContext) {
    return { agentContext } as any;
}

describe("@package handler completions", () => {
    it("install completes ref from listAvailable and --source from listSources", async () => {
        const source = fakeSource({
            listAvailable: async () => ["catalog-agent", "feed-agent"],
            listSources: () => ["catalog", "feed"],
        });
        const handler = getHandler(source, "install");
        const { host } = fakeHost();
        const result = await handler.getCompletion!(
            fakeSessionContext({ appAgentHost: host, source }),
            {} as any,
            ["ref", "--source"],
        );
        const byName = new Map(
            result.groups.map((g) => [g.name, g.completions]),
        );
        expect(byName.get("ref")).toEqual(["catalog-agent", "feed-agent"]);
        expect(byName.get("--source")).toEqual(["catalog", "feed"]);
    });

    it("uninstall/update complete the managed agent names", async () => {
        const source = fakeSource({
            listInstalled: () => [
                { name: "a", source: "path" },
                { name: "b", source: "feed" },
            ],
        });
        const { host } = fakeHost();
        for (const which of ["uninstall", "update"] as const) {
            const handler = getHandler(source, which);
            const result = await handler.getCompletion!(
                fakeSessionContext({ appAgentHost: host, source }),
                {} as any,
                ["name"],
            );
            const byName = new Map(
                result.groups.map((g) => [g.name, g.completions]),
            );
            expect(byName.get("name")).toEqual(["a", "b"]);
        }
    });
});
