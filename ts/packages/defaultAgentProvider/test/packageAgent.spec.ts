// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgentHost } from "agent-dispatcher";
import {
    buildPackageCommandTable,
    createPackageAppAgentProvider,
    InstalledAgentSourceApi,
    PackageAgentContext,
    PACKAGE_AGENT_NAME,
} from "../src/installSources/packageAgent.js";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";

const noopHost: AppAgentHost = {
    addProvider: async () => {},
    removeProvider: async () => {},
};

type SourceCall =
    | {
          op: "install";
          name: string;
          ref: string;
          sourceName?: string | undefined;
      }
    | { op: "uninstall"; name: string }
    | { op: "update"; name: string; range?: string | undefined };

// A source stub that records the handler's delegated calls (the handler is a
// thin shell over the source, which owns record mutation + fan-out).
function makeSource(overrides: Partial<InstalledAgentSourceApi> = {}): {
    api: InstalledAgentSourceApi;
    calls: SourceCall[];
} {
    const calls: SourceCall[] = [];
    const api: InstalledAgentSourceApi = {
        install: async (name, ref, sourceName) => {
            calls.push({ op: "install", name, ref, sourceName });
            return { source: "path" };
        },
        uninstall: async (name) => {
            calls.push({ op: "uninstall", name });
        },
        update: async (name, range) => {
            calls.push({ op: "update", name, range });
        },
        listInstalled: () => [],
        listSources: () => [],
        listAvailable: async () => [],
        sourceCommands: () => ({ description: "sources", commands: {} }),
        ...overrides,
    };
    return { api, calls };
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

function fakeSessionContext(agentContext: PackageAgentContext) {
    return { agentContext } as any;
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
        const { api } = makeSource();
        const ctx: PackageAgentContext = {
            appAgentHost: noopHost,
            source: api,
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

    it("install delegates to the source with the issuing host", async () => {
        const { api, calls } = makeSource();
        const handler = getHandler(api, "install");
        await handler.run(
            fakeActionContext({ appAgentHost: noopHost, source: api }),
            {
                args: { name: "foo", ref: "/some/path" },
                flags: { source: "path" },
            } as any,
        );
        expect(calls).toEqual([
            {
                op: "install",
                name: "foo",
                ref: "/some/path",
                sourceName: "path",
            },
        ]);
    });

    it("install rejects an illegal name before touching the source", async () => {
        const { api, calls } = makeSource();
        const handler = getHandler(api, "install");
        await expect(
            handler.run(
                fakeActionContext({ appAgentHost: noopHost, source: api }),
                { args: { name: "bad name!", ref: "/x" }, flags: {} } as any,
            ),
        ).rejects.toThrow(/not a legal agent name/i);
        expect(calls).toEqual([]);
    });

    it("uninstall delegates to the source with the issuing host", async () => {
        const { api, calls } = makeSource();
        const handler = getHandler(api, "uninstall");
        await handler.run(
            fakeActionContext({ appAgentHost: noopHost, source: api }),
            { args: { name: "foo" } } as any,
        );
        expect(calls).toEqual([{ op: "uninstall", name: "foo" }]);
    });

    it("update delegates to the source with the issuing host", async () => {
        const { api, calls } = makeSource();
        const handler = getHandler(api, "update");
        await handler.run(
            fakeActionContext({ appAgentHost: noopHost, source: api }),
            { args: { name: "foo", range: "^1.0" } } as any,
        );
        expect(calls).toEqual([{ op: "update", name: "foo", range: "^1.0" }]);
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
    it("install failure propagates to the user", async () => {
        const { api } = makeSource({
            install: async () => {
                throw new Error("resolution failed");
            },
        });
        const handler = getHandler(api, "install");
        await expect(
            handler.run(
                fakeActionContext({ appAgentHost: noopHost, source: api }),
                { args: { name: "foo", ref: "bad" }, flags: {} } as any,
            ),
        ).rejects.toThrow(/resolution failed/);
    });

    it("uninstall failure propagates to the user", async () => {
        const { api } = makeSource({
            uninstall: async () => {
                throw new Error("not found");
            },
        });
        const handler = getHandler(api, "uninstall");
        await expect(
            handler.run(
                fakeActionContext({ appAgentHost: noopHost, source: api }),
                { args: { name: "missing" } } as any,
            ),
        ).rejects.toThrow(/not found/);
    });

    it("update failure propagates to the user", async () => {
        const { api } = makeSource({
            update: async () => {
                throw new Error("source no longer configured");
            },
        });
        const handler = getHandler(api, "update");
        await expect(
            handler.run(
                fakeActionContext({ appAgentHost: noopHost, source: api }),
                { args: { name: "foo" } } as any,
            ),
        ).rejects.toThrow(/no longer configured/);
    });
});

describe("@package handler completions", () => {
    it("install completes ref from listAvailable and --source from listSources", async () => {
        const { api } = makeSource({
            listAvailable: async () => ["catalog-agent", "feed-agent"],
            listSources: () => ["catalog", "feed"],
        });
        const handler = getHandler(api, "install");
        const result = await handler.getCompletion!(
            fakeSessionContext({ appAgentHost: noopHost, source: api }),
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
        const { api } = makeSource({
            listInstalled: () => [
                { name: "a", source: "path" },
                { name: "b", source: "feed" },
            ],
        });
        for (const which of ["uninstall", "update"] as const) {
            const handler = getHandler(api, which);
            const result = await handler.getCompletion!(
                fakeSessionContext({ appAgentHost: noopHost, source: api }),
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
