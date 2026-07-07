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
    replaceProvider: async () => {},
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
        listAvailableAgents: async () => [],
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

function capturingActionContext(agentContext: PackageAgentContext) {
    const captured: string[] = [];
    const stripAnsi = (text: string) =>
        text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
    const context = {
        sessionContext: { agentContext },
        actionIO: {
            appendDisplay: (content: any) => {
                const text =
                    typeof content === "string"
                        ? content
                        : Array.isArray(content?.content)
                          ? content.content
                                .map((row: string[]) => row.join(" "))
                                .join("\n")
                          : (content?.content ?? JSON.stringify(content));
                captured.push(
                    typeof text === "string" ? stripAnsi(text) : text,
                );
            },
            setDisplay: () => {},
            takeAction: () => {},
        },
    } as any;
    return { context, output: () => captured.join("\n") };
}

function getHandler(
    source: InstalledAgentSourceApi,
    name: "install" | "uninstall" | "update" | "available",
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
        // dispatcher CommandHandlerContext (3.4).
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
            "available",
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
    it("install completes ref from listAvailableAgents and --source from listSources", async () => {
        const { api } = makeSource({
            listAvailableAgents: async () => [
                { ref: "catalog-agent", source: "catalog" },
                { ref: "feed-agent", source: "feed" },
            ],
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

    it("install ref completion narrows by --source when selected", async () => {
        const { api } = makeSource({
            listAvailableAgents: async ({ sourceName }: any = {}) => {
                if (sourceName === "catalog") {
                    return [{ ref: "catalog-agent", source: "catalog" }];
                }
                return [
                    { ref: "catalog-agent", source: "catalog" },
                    { ref: "feed-agent", source: "feed" },
                ];
            },
            listSources: () => ["catalog", "feed"],
        });
        const handler = getHandler(api, "install");
        const result = await handler.getCompletion!(
            fakeSessionContext({ appAgentHost: noopHost, source: api }),
            { flags: { source: "catalog" } } as any,
            ["ref"],
        );
        const byName = new Map(
            result.groups.map((g) => [g.name, g.completions]),
        );
        expect(byName.get("ref")).toEqual(["catalog-agent"]);
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

describe("@package available", () => {
    it("renders available refs with source in sorted order", async () => {
        const { api } = makeSource({
            listAvailableAgents: async () => [
                { ref: "zeta", source: "feed" },
                { ref: "alpha", source: "catalog" },
                { ref: "beta", source: "feed" },
            ],
        });
        const handler = getHandler(api, "available");
        const { context, output } = capturingActionContext({
            appAgentHost: noopHost,
            source: api,
        });
        await handler.run(context, { args: {} } as any);
        const text = output();
        expect(text).toContain("Ref Source");
        expect(text).toContain("alpha catalog");
        expect(text).toContain("beta feed");
        expect(text).toContain("zeta feed");
        expect(text).toContain("alpha");
        expect(text).toContain("beta");
        expect(text).toContain("zeta");
        expect(text.indexOf("alpha")).toBeLessThan(text.indexOf("beta"));
        expect(text.indexOf("beta")).toBeLessThan(text.indexOf("zeta"));
    });

    it("reports empty state when no refs are available", async () => {
        const { api } = makeSource({
            listAvailableAgents: async () => [],
        });
        const handler = getHandler(api, "available");
        const { context, output } = capturingActionContext({
            appAgentHost: noopHost,
            source: api,
        });
        await handler.run(context, { args: {} } as any);
        expect(output()).toContain("No installable agent refs found.");
    });

    it("supports filtering by --source", async () => {
        const { api } = makeSource({
            listAvailableAgents: async ({ sourceName }: any = {}) => {
                if (sourceName === "catalog") {
                    return [{ ref: "alpha", source: "catalog" }];
                }
                return [
                    { ref: "alpha", source: "catalog" },
                    { ref: "beta", source: "feed" },
                ];
            },
        });
        const handler = getHandler(api, "available");
        const { context, output } = capturingActionContext({
            appAgentHost: noopHost,
            source: api,
        });
        await handler.run(context, { flags: { source: "catalog" } } as any);
        const text = output();
        expect(text).toContain("alpha catalog");
        expect(text).not.toContain("beta feed");
    });

    it("completes --source from listSources", async () => {
        const { api } = makeSource({
            listSources: () => ["catalog", "feed"],
        });
        const handler = getHandler(api, "available");
        const result = await handler.getCompletion!(
            fakeSessionContext({ appAgentHost: noopHost, source: api }),
            {} as any,
            ["--source"],
        );
        const byName = new Map(
            result.groups.map((g) => [g.name, g.completions]),
        );
        expect(byName.get("--source")).toEqual(["catalog", "feed"]);
    });
});
