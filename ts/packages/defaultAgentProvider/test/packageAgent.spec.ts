// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AppAgentProviderSetController } from "agent-dispatcher";
import {
    buildPackageCommandTable,
    createPackageAppAgentProvider,
    InstalledAgentSourceApi,
    PackageAgentContext,
    PACKAGE_AGENT_NAME,
} from "../src/installSources/packageAgent.js";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import { McpServerSourceApi } from "../src/mcp/mcpAppAgentSource.js";
import { NormalizedMcpServerConfig } from "../src/mcp/mcpServerConfig.js";
import { McpInstallCandidate } from "../src/installSources/config.js";

const noopHost: AppAgentProviderSetController = {
    runExclusive: async (callback) => {
        const value = await callback({
            addProvider: async () => {},
            removeProvider: async () => {},
        });
        return { status: "completed", value };
    },
};

type SourceCall =
    | {
          op: "install";
          nameOrTarget: string;
          ref?: string | undefined;
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
        install: async (nameOrTarget, ref, sourceName) => {
            calls.push({ op: "install", nameOrTarget, ref, sourceName });
            return {
                name: nameOrTarget,
                source: "path",
                matchedByName: false,
            };
        },
        preview: async () => undefined,
        resolveMcp: async () => [],
        refresh: async () => {},
        uninstall: async (name) => {
            calls.push({ op: "uninstall", name });
        },
        update: async (name, range) => {
            calls.push({ op: "update", name, range });
            return { status: "started" };
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
        sessionContext: { agentContext, notify: () => {} },
        actionIO: {
            appendDisplay: () => {},
            setDisplay: () => {},
            takeAction: () => {},
        },
    } as any;
}

// An action context that captures both inline displays (actionIO) and the
// session notifications (sessionContext.notify) — the terminal
// uninstall/update outcomes are delivered through the latter because they
// settle after the command's ActionContext is already finished.
function notifyCapturingActionContext(agentContext: PackageAgentContext) {
    const notifications: string[] = [];
    const context = {
        sessionContext: {
            agentContext,
            notify: (_event: unknown, message: string) => {
                notifications.push(message);
            },
        },
        actionIO: {
            appendDisplay: () => {},
            setDisplay: () => {},
            takeAction: () => {},
        },
    } as any;
    return { context, notifications };
}

function fakeSessionContext(agentContext: PackageAgentContext) {
    return { agentContext } as any;
}

function makeMcpSource(initial: NormalizedMcpServerConfig[] = []) {
    const servers = new Map(initial.map((config) => [config.id, config]));
    const calls: string[] = [];
    const api: McpServerSourceApi = {
        async addServer(config) {
            calls.push(`add:${config.id}`);
            servers.set(config.id, config);
        },
        async removeServer(id) {
            calls.push(`remove:${id}`);
            return servers.delete(id);
        },
        listServers: () => [...servers.values()],
        getServer: (id) => servers.get(id),
        async setTrust(id, trust) {
            calls.push(`trust:${id}:${trust}`);
            const config = servers.get(id)!;
            const updated = { ...config, trust };
            servers.set(id, updated);
            return updated;
        },
        async setEnabled(id, enabled) {
            calls.push(`enabled:${id}:${enabled}`);
            const config = servers.get(id)!;
            const updated = { ...config, enabled };
            servers.set(id, updated);
            return updated;
        },
        async updateServer(id, update) {
            const config = servers.get(id)!;
            const updated = { ...config, ...update };
            servers.set(id, updated);
            return updated;
        },
        async testServer(id, allowUntrusted) {
            calls.push(`test:${id}:${allowUntrusted}`);
            return { protocolVersion: "2025-06-18", tools: ["echo"] };
        },
    };
    return { api, calls, servers };
}

function makeMcpConfig(
    name: string,
    overrides: Partial<NormalizedMcpServerConfig> = {},
): NormalizedMcpServerConfig {
    return {
        id: `mcp:local:${name}`,
        name,
        transport: { kind: "stdio", command: "node", args: ["server.js"] },
        enabled: false,
        trust: "untrusted",
        scope: "workspace",
        provenance: {
            source: "local",
            sourceKind: "mcp-config",
            ref: name,
        },
        ...overrides,
    };
}

function makeMcpCandidate(
    name: string,
    overrides: Partial<NormalizedMcpServerConfig> = {},
): McpInstallCandidate {
    return {
        extensionKind: "mcp",
        source: "local",
        sourceKind: "mcp-config",
        ref: name,
        config: makeMcpConfig(name, overrides),
    };
}

function mcpActionContext(agentContext: PackageAgentContext, choice = 0) {
    const captured: string[] = [];
    const questions: string[] = [];
    const context = {
        sessionContext: {
            agentContext,
            notify: () => {},
            popupQuestion: async (message: string) => {
                questions.push(message);
                return choice;
            },
        },
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
                    typeof text === "string"
                        ? text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
                        : text,
                );
            },
            setDisplay: () => {},
            takeAction: () => {},
        },
    } as any;
    return {
        context,
        output: () => captured.join("\n"),
        questions,
    };
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

function tightlyCapturingActionContext(agentContext: PackageAgentContext) {
    const captured: string[] = [];
    const modes: Array<string | undefined> = [];
    const stripAnsi = (text: string) =>
        text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
    const context = {
        sessionContext: { agentContext },
        actionIO: {
            appendDisplay: (content: any, mode?: string) => {
                modes.push(mode);
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
    return { context, output: () => captured.join(""), modes };
}

function getHandler(
    source: InstalledAgentSourceApi,
    name: "install" | "uninstall" | "update" | "available" | "list",
): CommandHandler {
    const table = buildPackageCommandTable(source.sourceCommands());
    return table.commands[name] as CommandHandler;
}

function getMcpHandler(
    source: InstalledAgentSourceApi,
    name:
        | "import"
        | "inspect"
        | "test"
        | "trust"
        | "untrust"
        | "enable"
        | "disable",
): CommandHandler {
    const table = buildPackageCommandTable(source.sourceCommands());
    return (table.commands.mcp as any).commands[name] as CommandHandler;
}

describe("@package agent", () => {
    it("vends a command-only agent named 'package' with the host-owned context", async () => {
        const { api } = makeSource();
        const ctx: PackageAgentContext = {
            appAgentProviderSetController: noopHost,
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
            fakeActionContext({
                appAgentProviderSetController: noopHost,
                source: api,
            }),
            {
                args: { target: "/some/path", name: "foo" },
                flags: { source: "path" },
            } as any,
        );
        expect(calls).toEqual([
            {
                op: "install",
                nameOrTarget: "foo",
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
                fakeActionContext({
                    appAgentProviderSetController: noopHost,
                    source: api,
                }),
                {
                    args: { target: "/x", name: "bad name!" },
                    flags: {},
                } as any,
            ),
        ).rejects.toThrow(/not a legal agent name/i);
        expect(calls).toEqual([]);
    });

    it("uninstall delegates to the source with the issuing host", async () => {
        const { api, calls } = makeSource();
        const handler = getHandler(api, "uninstall");
        await handler.run(
            fakeActionContext({
                appAgentProviderSetController: noopHost,
                source: api,
            }),
            { args: { name: "foo" } } as any,
        );
        expect(calls).toEqual([{ op: "uninstall", name: "foo" }]);
    });

    it("update delegates to the source with the issuing host", async () => {
        const { api, calls } = makeSource();
        const handler = getHandler(api, "update");
        await handler.run(
            fakeActionContext({
                appAgentProviderSetController: noopHost,
                source: api,
            }),
            { args: { name: "foo", range: "^1.0" } } as any,
        );
        expect(calls).toEqual([{ op: "update", name: "foo", range: "^1.0" }]);
    });

    it("uninstall acknowledges start without echoing a committed teardown", async () => {
        // A committed uninstall is announced by the source's cross-session
        // fan-out ("was removed"), like install's "was added" — the command
        // adds no echo of its own.
        const { api } = makeSource({
            uninstall: async (_name, _host, onOutcome) => {
                onOutcome?.("uninstalled");
            },
        });
        const handler = getHandler(api, "uninstall");
        const { context, output } = capturingActionContext({
            appAgentProviderSetController: noopHost,
            source: api,
        });
        await handler.run(context, { args: { name: "foo" } } as any);
        expect(output()).toContain(
            "Agent 'foo' uninstall started; it will unload from each session shortly.",
        );
        expect(output()).not.toContain("was removed");
    });

    it("uninstall reports started when teardown outcome is asynchronous", async () => {
        const { api } = makeSource({
            uninstall: async () => {
                // Intentionally no immediate outcome callback: this models the
                // real drain path, where completion settles later.
            },
        });
        const handler = getHandler(api, "uninstall");
        const { context, output } = capturingActionContext({
            appAgentProviderSetController: noopHost,
            source: api,
        });
        await handler.run(context, { args: { name: "foo" } } as any);
        expect(output()).toContain(
            "Agent 'foo' uninstall started; it will unload from each session shortly.",
        );
    });

    it("uninstall surfaces a reverted teardown (the fan-out is silent on rollback)", async () => {
        const { api } = makeSource({
            uninstall: async (_name, _host, onOutcome) => {
                onOutcome?.("reverted");
            },
        });
        const handler = getHandler(api, "uninstall");
        const { context, notifications } = notifyCapturingActionContext({
            appAgentProviderSetController: noopHost,
            source: api,
        });
        await handler.run(context, { args: { name: "foo" } } as any);
        expect(notifications).toEqual([
            "Agent 'foo' uninstall reverted; the agent is still installed.",
        ]);
    });

    it("update does not echo a committed swap (the source fan-out owns it)", async () => {
        const { api } = makeSource({
            update: async (_name, _range, _host, onOutcome) => {
                onOutcome?.("updated");
                return { status: "started" };
            },
        });
        const handler = getHandler(api, "update");
        const { context, notifications } = notifyCapturingActionContext({
            appAgentProviderSetController: noopHost,
            source: api,
        });
        await handler.run(context, {
            args: { name: "foo", range: undefined },
        } as any);
        expect(notifications).toEqual([]);
    });

    it("update surfaces a reverted swap", async () => {
        const { api } = makeSource({
            update: async (_name, _range, _host, onOutcome) => {
                onOutcome?.("reverted");
                return { status: "started" };
            },
        });
        const handler = getHandler(api, "update");
        const { context, notifications } = notifyCapturingActionContext({
            appAgentProviderSetController: noopHost,
            source: api,
        });
        await handler.run(context, {
            args: { name: "foo", range: undefined },
        } as any);
        expect(notifications).toEqual([
            "Agent 'foo' update failed; reverted to the previous version.",
        ]);
    });

    it("update surfaces an already-current no-op", async () => {
        const { api } = makeSource({
            update: async () => ({ status: "unchanged" }),
        });
        const handler = getHandler(api, "update");
        const { context, output } = capturingActionContext({
            appAgentProviderSetController: noopHost,
            source: api,
        });
        await handler.run(context, {
            args: { name: "foo", range: undefined },
        } as any);
        expect(output()).toContain("Agent 'foo' is already up to date.");
    });

    it("update reports started when swap outcome is asynchronous", async () => {
        const { api } = makeSource({
            update: async () => ({ status: "started" }),
        });
        const handler = getHandler(api, "update");
        const { context, output } = capturingActionContext({
            appAgentProviderSetController: noopHost,
            source: api,
        });
        await handler.run(context, {
            args: { name: "foo", range: undefined },
        } as any);
        expect(output()).toContain(
            "Agent 'foo' update started; it will reload in each session shortly.",
        );
    });

    it("update reports the package version change when available", async () => {
        const { api } = makeSource({
            update: async () => ({
                status: "started",
                packageName: "@typeagent/foo-agent",
                oldVersion: "1.0.0",
                newVersion: "1.4.0",
            }),
        });
        const handler = getHandler(api, "update");
        const { context, output } = capturingActionContext({
            appAgentProviderSetController: noopHost,
            source: api,
        });
        await handler.run(context, {
            args: { name: "foo", range: undefined },
        } as any);
        expect(output()).toContain(
            "Agent 'foo' update for package '@typeagent/foo-agent' (1.0.0 -> 1.4.0) started; it will reload in each session shortly.",
        );
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
            "mcp",
            "source",
            "uninstall",
            "update",
        ]);
        // `@package source` points at the exact host-provided table instance.
        expect(table.commands.source).toBe(sourceTable);
        expect(
            (table.commands.install as any).parameters.flags.type,
        ).toMatchObject({ type: "string", default: "all" });
        expect(
            (table.commands.list as any).parameters.flags.type,
        ).toMatchObject({
            type: "string",
            default: "agent",
        });
        expect(
            Object.keys((table.commands.mcp as any).commands).sort(),
        ).toEqual([
            "auth",
            "credentials",
            "disable",
            "enable",
            "import",
            "inspect",
            "policy",
            "status",
            "test",
            "trust",
            "untrust",
        ]);
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
                fakeActionContext({
                    appAgentProviderSetController: noopHost,
                    source: api,
                }),
                { args: { target: "bad" }, flags: {} } as any,
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
                fakeActionContext({
                    appAgentProviderSetController: noopHost,
                    source: api,
                }),
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
                fakeActionContext({
                    appAgentProviderSetController: noopHost,
                    source: api,
                }),
                { args: { name: "foo" } } as any,
            ),
        ).rejects.toThrow(/no longer configured/);
    });
});

describe("@package handler completions", () => {
    it("install completes target from listAvailableAgents and --source from listSources", async () => {
        const { api } = makeSource({
            listAvailableAgents: async () => [
                {
                    source: "catalog",
                    agents: [
                        {
                            ref: "k1",
                            defaultAgentName: "catalog-agent",
                            packageName: "@x/catalog-agent",
                        },
                    ],
                },
                {
                    source: "feed",
                    agents: [
                        {
                            ref: "@x/feed-agent",
                            defaultAgentName: "feed-agent",
                            packageName: "@x/feed-agent",
                        },
                    ],
                },
            ],
            listSources: () => ["catalog", "feed"],
        });
        const handler = getHandler(api, "install");
        const result = await handler.getCompletion!(
            fakeSessionContext({
                appAgentProviderSetController: noopHost,
                source: api,
            }),
            {} as any,
            ["target", "--source"],
        );
        const byName = new Map(
            result.groups.map((g) => [g.name, g.completions]),
        );
        expect(byName.get("target")).toEqual([
            "catalog-agent",
            "@x/catalog-agent",
            "feed-agent",
            "@x/feed-agent",
        ]);
        expect(byName.get("--source")).toEqual(["catalog", "feed"]);
    });

    it("install target completion narrows by --source when selected", async () => {
        const { api } = makeSource({
            listAvailableAgents: async ({ sourceName }: any = {}) => {
                if (sourceName === "catalog") {
                    return [
                        {
                            source: "catalog",
                            agents: [
                                {
                                    ref: "k1",
                                    defaultAgentName: "catalog-agent",
                                    packageName: "@x/catalog-agent",
                                },
                            ],
                        },
                    ];
                }
                return [
                    {
                        source: "catalog",
                        agents: [
                            {
                                ref: "k1",
                                defaultAgentName: "catalog-agent",
                                packageName: "@x/catalog-agent",
                            },
                        ],
                    },
                    {
                        source: "feed",
                        agents: [
                            {
                                ref: "@x/feed-agent",
                                defaultAgentName: "feed-agent",
                                packageName: "@x/feed-agent",
                            },
                        ],
                    },
                ];
            },
            listSources: () => ["catalog", "feed"],
        });
        const handler = getHandler(api, "install");
        const result = await handler.getCompletion!(
            fakeSessionContext({
                appAgentProviderSetController: noopHost,
                source: api,
            }),
            { flags: { source: "catalog" } } as any,
            ["target"],
        );
        const byName = new Map(
            result.groups.map((g) => [g.name, g.completions]),
        );
        expect(byName.get("target")).toEqual([
            "catalog-agent",
            "@x/catalog-agent",
        ]);
    });

    it("uninstall/update complete the managed agent names", async () => {
        const { api } = makeSource({
            listInstalled: () => [
                { source: "path", agents: [{ name: "a" }] },
                { source: "feed", agents: [{ name: "b" }] },
            ],
        });
        for (const which of ["uninstall", "update"] as const) {
            const handler = getHandler(api, which);
            const result = await handler.getCompletion!(
                fakeSessionContext({
                    appAgentProviderSetController: noopHost,
                    source: api,
                }),
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
    it("renders one sorted table per source in source order", async () => {
        const { api } = makeSource({
            listAvailableAgents: async () => [
                {
                    source: "feed",
                    sourceKind: "feed",
                    agents: [
                        {
                            ref: "@x/zeta",
                            defaultAgentName: "zeta",
                            packageName: "@x/zeta",
                        },
                        {
                            ref: "@x/beta",
                            defaultAgentName: "beta",
                            packageName: "@x/beta",
                            description: "Beta test agent",
                        },
                    ],
                },
                {
                    source: "catalog",
                    sourceKind: "catalog",
                    agents: [
                        {
                            ref: "k-alpha",
                            defaultAgentName: "alpha",
                            packageName: "alpha-pkg",
                            description: "Alpha test agent",
                        },
                    ],
                },
            ],
        });
        const handler = getHandler(api, "available");
        const { context, output, modes } = tightlyCapturingActionContext({
            appAgentProviderSetController: noopHost,
            source: api,
        });
        await handler.run(context, { args: {}, flags: {} } as any);
        const text = output();
        expect(text).toContain(
            "feed (feed)\nName Package Description\nbeta @x/beta Beta test agent\nzeta @x/zeta —",
        );
        expect(text).toContain(
            "\ncatalog (catalog)\nName Package Description\nalpha alpha-pkg Alpha test agent",
        );
        expect(text.indexOf("feed")).toBeLessThan(text.indexOf("catalog"));
        expect(text.indexOf("beta")).toBeLessThan(text.indexOf("zeta"));
        expect(modes).toEqual(["block", "block", "block", "block"]);
    });

    it("reports empty state when no agents are available", async () => {
        const { api } = makeSource({
            listAvailableAgents: async () => [],
        });
        const handler = getHandler(api, "available");
        const { context, output } = capturingActionContext({
            appAgentProviderSetController: noopHost,
            source: api,
        });
        await handler.run(context, { args: {}, flags: {} } as any);
        expect(output()).toContain("No installable agents found.");
    });

    it("supports filtering by --source", async () => {
        const { api } = makeSource({
            listAvailableAgents: async ({ sourceName }: any = {}) => {
                if (sourceName === "catalog") {
                    return [
                        {
                            source: "catalog",
                            agents: [
                                {
                                    ref: "k-alpha",
                                    defaultAgentName: "alpha",
                                    packageName: "alpha-pkg",
                                },
                            ],
                        },
                    ];
                }
                return [
                    {
                        source: "catalog",
                        agents: [
                            {
                                ref: "k-alpha",
                                defaultAgentName: "alpha",
                                packageName: "alpha-pkg",
                            },
                        ],
                    },
                    {
                        source: "feed",
                        agents: [
                            {
                                ref: "@x/beta",
                                defaultAgentName: "beta",
                                packageName: "@x/beta",
                            },
                        ],
                    },
                ];
            },
        });
        const handler = getHandler(api, "available");
        const { context, output } = capturingActionContext({
            appAgentProviderSetController: noopHost,
            source: api,
        });
        await handler.run(context, {
            args: {},
            flags: { source: "catalog" },
        } as any);
        const text = output();
        expect(text).toContain("catalog");
        expect(text).toContain("alpha alpha-pkg");
        expect(text).not.toContain("feed");
        expect(text).not.toContain("beta @x/beta");
    });

    it("completes --source from listSources", async () => {
        const { api } = makeSource({
            listSources: () => ["catalog", "feed"],
        });
        const handler = getHandler(api, "available");
        const result = await handler.getCompletion!(
            fakeSessionContext({
                appAgentProviderSetController: noopHost,
                source: api,
            }),
            {} as any,
            ["--source"],
        );
        const byName = new Map(
            result.groups.map((g) => [g.name, g.completions]),
        );
        expect(byName.get("--source")).toEqual(["catalog", "feed"]);
    });
});

describe("@package list", () => {
    it("renders source headings, tables, and footer in block mode", async () => {
        const { api } = makeSource({
            listInstalled: () => [
                {
                    source: "feed-source",
                    sourceKind: "feed",
                    agents: [{ name: "beta", ref: "pkg-beta" }],
                },
                {
                    source: "catalog-source",
                    sourceKind: "catalog",
                    agents: [{ name: "alpha", ref: "pkg-alpha" }],
                },
            ],
        });
        const handler = getHandler(api, "list");
        const { context, output, modes } = tightlyCapturingActionContext({
            appAgentProviderSetController: noopHost,
            source: api,
        });

        await handler.run(context, { args: {} } as any);

        expect(output()).toContain(
            "feed-source (feed)\nName Reference\nbeta pkg-beta\ncatalog-source (catalog)\nName Reference\nalpha pkg-alpha\nShowing installable installed agents only.",
        );
        expect(modes).toEqual(["block", "block", "block", "block", "block"]);
    });
});

describe("@package install one-argument, dry-run, and refresh", () => {
    it("one-argument install maps target to install(target, undefined) and shows the match kind", async () => {
        const { api, calls } = makeSource({
            install: async (nameOrTarget, ref, sourceName) => {
                calls.push({ op: "install", nameOrTarget, ref, sourceName });
                return {
                    name: "weather",
                    source: "typeagent",
                    sourceKind: "feed",
                    matchedByName: true,
                    packageName: "@typeagent/weather-agent",
                };
            },
        });
        const handler = getHandler(api, "install");
        const { context, output } = capturingActionContext({
            appAgentProviderSetController: noopHost,
            source: api,
        });
        await handler.run(context, {
            args: { target: "weather" },
            flags: {},
        } as any);
        // One argument -> ref is undefined (infer mode).
        expect(calls).toEqual([
            {
                op: "install",
                nameOrTarget: "weather",
                ref: undefined,
                sourceName: undefined,
            },
        ]);
        const text = output();
        // The install confirmation and the match clarification are separate
        // messages. The confirmation names the source kind.
        expect(text).toContain(
            "Agent 'weather' installed from package '@typeagent/weather-agent' via feed source 'typeagent';",
        );
        expect(text).toContain("Matched default agent name 'weather'.");
    });

    it("two-argument install omits the match-kind note (the name was explicit)", async () => {
        const { api } = makeSource({
            install: async () => ({
                name: "teamWeather",
                source: "typeagent",
                matchedByName: false,
                packageName: "@typeagent/weather-agent",
            }),
        });
        const handler = getHandler(api, "install");
        const { context, output } = capturingActionContext({
            appAgentProviderSetController: noopHost,
            source: api,
        });
        await handler.run(context, {
            args: { target: "@typeagent/weather-agent", name: "teamWeather" },
            flags: {},
        } as any);
        const text = output();
        expect(text).toContain(
            "Agent 'teamWeather' installed from package '@typeagent/weather-agent' via source 'typeagent';",
        );
        // No "(...)" match-kind note for an explicit name.
        expect(text).not.toContain("(");
    });

    it("--dry-run previews the winning source and the shadow set without installing", async () => {
        const calls: string[] = [];
        const { api } = makeSource({
            install: async () => {
                calls.push("install");
                return { name: "x", source: "s", matchedByName: false };
            },
            preview: async (nameOrTarget, ref) => {
                calls.push(`preview:${nameOrTarget}:${ref}`);
                return {
                    winner: {
                        source: "workspace",
                        matchKind: "packageName",
                        name: "weather",
                        packageName: "weather-agent",
                    },
                    matches: [
                        {
                            source: "workspace",
                            matchKind: "packageName",
                            name: "weather",
                            packageName: "weather-agent",
                        },
                        {
                            source: "typeagent",
                            matchKind: "path",
                            name: "weather",
                            path: "/p/weather",
                        },
                    ],
                };
            },
        });
        const handler = getHandler(api, "install");
        const { context, output } = capturingActionContext({
            appAgentProviderSetController: noopHost,
            source: api,
        });
        await handler.run(context, {
            args: { target: "weather-agent" },
            flags: { "dry-run": true },
        } as any);
        // Dry-run never installs.
        expect(calls).toEqual(["preview:weather-agent:undefined"]);
        const text = output();
        expect(text).toContain("would resolve via source 'workspace'");
        expect(text).toContain("as package 'weather-agent'");
        expect(text).toContain("install as 'weather'");
        expect(text).toContain("Also matched: source 'typeagent'");
    });

    it("--refresh refreshes the (optionally filtered) source before installing", async () => {
        let refreshedWith: string | null | undefined = undefined;
        const { api } = makeSource({
            refresh: async (sourceName) => {
                refreshedWith = sourceName ?? null;
            },
            install: async (nameOrTarget) => ({
                name: nameOrTarget,
                source: "path",
                matchedByName: false,
            }),
        });
        const handler = getHandler(api, "install");
        const { context } = capturingActionContext({
            appAgentProviderSetController: noopHost,
            source: api,
        });
        await handler.run(context, {
            args: { target: "x", name: "y" },
            flags: { refresh: true, source: "path" },
        } as any);
        expect(refreshedWith).toBe("path");
    });
});

describe("@package MCP management", () => {
    it("previews and imports Copilot workspace configs disabled and untrusted", async () => {
        const workspace = await mkdtemp(
            path.join(os.tmpdir(), "mcp-package-import-"),
        );
        await writeFile(
            path.join(workspace, ".mcp.json"),
            JSON.stringify({
                mcpServers: {
                    discoveredEcho: { command: "node", args: ["echo.js"] },
                },
            }),
        );
        const { api } = makeSource();
        const mcp = makeMcpSource();
        const capture = mcpActionContext({
            appAgentProviderSetController: noopHost,
            source: api,
            mcpSource: mcp.api,
        });

        await getMcpHandler(api, "import").run(capture.context, {
            flags: {
                from: "copilot",
                workspace,
                "dry-run": false,
            },
        } as any);

        const imported = [...mcp.servers.values()].find(
            (config) => config.name === "discoveredEcho",
        );
        expect(capture.questions).toHaveLength(2);
        expect(imported).toMatchObject({
            enabled: false,
            trust: "untrusted",
            transport: { command: "node", args: ["echo.js"] },
            provenance: {
                source: path.join(workspace, ".mcp.json"),
                sourceKind: "workspace-mcp",
            },
        });
        expect(capture.output()).toContain("Imported");
    });

    it("rejects an implicit install when native and MCP candidates share a name", async () => {
        const { api } = makeSource({
            resolveMcp: async () => [makeMcpCandidate("echo")],
            preview: async () => ({
                winner: {
                    source: "feed",
                    matchKind: "defaultAgentName",
                    name: "echo",
                },
                matches: [
                    {
                        source: "feed",
                        matchKind: "defaultAgentName",
                        name: "echo",
                    },
                ],
            }),
        });
        const { api: mcpSource } = makeMcpSource();
        const handler = getHandler(api, "install");
        await expect(
            handler.run(
                mcpActionContext({
                    appAgentProviderSetController: noopHost,
                    source: api,
                    mcpSource,
                }).context,
                {
                    args: { target: "echo" },
                    flags: { type: "all" },
                } as any,
            ),
        ).rejects.toThrow(/matches both a native agent and an MCP server/);
    });

    it("previews an MCP install without persisting or prompting", async () => {
        const candidate = makeMcpCandidate("echo", {
            transport: {
                kind: "stdio",
                command: "node",
                args: ["server.js"],
                cwd: "C:\\workspace",
                env: {
                    TOKEN: { kind: "input", name: "api-token" },
                    MODE: "safe",
                },
            },
            enabledTools: ["echo"],
        });
        const { api } = makeSource({
            resolveMcp: async () => [candidate],
        });
        const mcp = makeMcpSource();
        const capture = mcpActionContext({
            appAgentProviderSetController: noopHost,
            source: api,
            mcpSource: mcp.api,
        });
        await getHandler(api, "install").run(capture.context, {
            args: { target: "echo" },
            flags: { type: "mcp", "dry-run": true },
        } as any);
        expect(capture.output()).toContain("Command: node server.js");
        expect(capture.output()).toContain("Cwd: C:\\workspace");
        expect(capture.output()).toContain(
            "TOKEN=<credential input:api-token>",
        );
        expect(capture.output()).toContain("MODE=<literal>");
        expect(capture.output()).toContain("Tools: echo");
        expect(capture.questions).toEqual([]);
        expect(mcp.calls).toEqual([]);
    });

    it("requires confirmation and installs disabled, untrusted, without plaintext credentials", async () => {
        const candidate = makeMcpCandidate("echo", {
            transport: {
                kind: "http",
                url: "https://example.com/mcp",
                headers: {
                    Authorization: { kind: "env", name: "MCP_TOKEN" },
                },
            },
        });
        const { api } = makeSource({
            resolveMcp: async () => [candidate],
        });
        const mcp = makeMcpSource();
        const capture = mcpActionContext({
            appAgentProviderSetController: noopHost,
            source: api,
            mcpSource: mcp.api,
        });
        await getHandler(api, "install").run(capture.context, {
            args: { target: "echo" },
            flags: { type: "mcp" },
        } as any);
        const stored = mcp.servers.get(candidate.config.id)!;
        expect(capture.questions).toHaveLength(1);
        expect(stored).toMatchObject({
            enabled: false,
            trust: "untrusted",
            provenance: {
                source: "local",
                sourceKind: "mcp-config",
                ref: "echo",
            },
        });
        expect(JSON.stringify(stored)).not.toContain("plaintext-secret");
        expect(JSON.stringify(stored)).toContain('"name":"MCP_TOKEN"');
    });

    it("cancels an MCP install without persisting", async () => {
        const { api } = makeSource({
            resolveMcp: async () => [makeMcpCandidate("echo")],
        });
        const mcp = makeMcpSource();
        const capture = mcpActionContext(
            {
                appAgentProviderSetController: noopHost,
                source: api,
                mcpSource: mcp.api,
            },
            1,
        );
        await getHandler(api, "install").run(capture.context, {
            args: { target: "echo" },
            flags: { type: "mcp" },
        } as any);
        expect(mcp.calls).toEqual([]);
        expect(capture.output()).toContain("MCP installation cancelled.");
    });

    it("cleans materialized MCP paths when post-materialization policy rejects", async () => {
        const candidate = makeMcpCandidate("echo");
        const materialized = makeMcpConfig("echo", {
            provenance: {
                source: "official",
                sourceKind: "registry",
                ref: "io.example/echo@1.0.0",
                npmRegistryUrl: "https://registry.npmjs.org/",
                ownedPaths: ["owned-root"],
            },
        });
        const cleaned: NormalizedMcpServerConfig[] = [];
        const { api } = makeSource({
            resolveMcp: async () => [candidate],
            materializeMcp: async () => materialized,
            cleanupMcp: (config) => cleaned.push(config),
        });
        const mcp = makeMcpSource();
        (mcp.api as any).getPolicy = () => ({
            allowedTransports: ["stdio"],
            allowPublicNpmRegistry: false,
        });
        const capture = mcpActionContext({
            appAgentProviderSetController: noopHost,
            source: api,
            mcpSource: mcp.api,
        });

        await expect(
            getHandler(api, "install").run(capture.context, {
                args: { target: "echo" },
                flags: { type: "mcp" },
            } as any),
        ).rejects.toThrow(/public npm registry materialization is disabled/);

        expect(cleaned).toEqual([materialized]);
        expect(mcp.servers.size).toBe(0);
    });

    it("lists and uninstalls MCP servers through --type mcp", async () => {
        const config = makeMcpConfig("echo");
        const { api } = makeSource();
        const mcp = makeMcpSource([config]);
        const capture = mcpActionContext({
            appAgentProviderSetController: noopHost,
            source: api,
            mcpSource: mcp.api,
        });
        await getHandler(api, "list").run(capture.context, {
            flags: { type: "mcp" },
        } as any);
        expect(capture.output()).toContain("echo node untrusted no local");
        await getHandler(api, "uninstall").run(capture.context, {
            args: { name: "echo" },
            flags: { type: "mcp" },
        } as any);
        expect(mcp.calls).toContain(`remove:${config.id}`);
        expect(mcp.servers.size).toBe(0);
    });

    it("re-resolves local config updates, previews changes, and preserves state", async () => {
        const current = makeMcpConfig("echo", {
            enabled: true,
            trust: "trusted",
        });
        const candidate = makeMcpCandidate("echo", {
            transport: {
                kind: "stdio",
                command: "node",
                args: ["server-v2.js"],
            },
        });
        const { api } = makeSource({
            resolveMcp: async (ref, sourceName) => {
                expect(ref).toBe("echo");
                expect(sourceName).toBe("local");
                return [candidate];
            },
        });
        const mcp = makeMcpSource([current]);
        const capture = mcpActionContext({
            appAgentProviderSetController: noopHost,
            source: api,
            mcpSource: mcp.api,
        });
        await getHandler(api, "update").run(capture.context, {
            args: { name: "echo" },
            flags: { type: "mcp" },
        } as any);
        expect(capture.output()).toContain("Changes: transport");
        expect(mcp.servers.get(current.id)).toMatchObject({
            enabled: true,
            trust: "trusted",
            transport: { args: ["server-v2.js"] },
        });
    });

    it("materializes registry updates before replacement and cleans the superseded root", async () => {
        const current = makeMcpConfig("echo", {
            provenance: {
                source: "official",
                sourceKind: "registry",
                ref: "io.example/echo@1.0.0",
                canonicalServerName: "io.example/echo",
                serverVersion: "1.0.0",
                digest: "old",
                ownedPaths: ["old-root"],
            },
        });
        const candidate = makeMcpCandidate("echo", {
            provenance: {
                source: "official",
                sourceKind: "registry",
                ref: "io.example/echo@2.0.0",
                canonicalServerName: "io.example/echo",
                serverVersion: "2.0.0",
                digest: "new",
            },
        });
        const cleaned: string[][] = [];
        const { api } = makeSource({
            resolveMcp: async (ref, sourceName) => {
                expect(ref).toBe("io.example/echo@2.0.0");
                expect(sourceName).toBe("official");
                return [candidate];
            },
            materializeMcp: async () => ({
                ...candidate.config,
                provenance: {
                    ...candidate.config.provenance,
                    ownedPaths: ["new-root"],
                },
            }),
            cleanupMcp: (config) =>
                cleaned.push(config.provenance.ownedPaths ?? []),
        });
        const mcp = makeMcpSource([current]);
        const capture = mcpActionContext({
            appAgentProviderSetController: noopHost,
            source: api,
            mcpSource: mcp.api,
        });
        await getHandler(api, "update").run(capture.context, {
            args: { name: "echo", range: "2.0.0" },
            flags: { type: "mcp" },
        } as any);
        expect(mcp.servers.get(current.id)?.provenance).toMatchObject({
            serverVersion: "2.0.0",
            ownedPaths: ["new-root"],
        });
        expect(cleaned).toEqual([["old-root"]]);
    });

    it("cleans registry-owned content after a successful MCP uninstall", async () => {
        const config = makeMcpConfig("echo", {
            provenance: {
                source: "official",
                sourceKind: "registry",
                ref: "io.example/echo@1.0.0",
                ownedPaths: ["owned-root"],
            },
        });
        const cleaned: string[][] = [];
        const { api } = makeSource({
            cleanupMcp: (removed) =>
                cleaned.push(removed.provenance.ownedPaths ?? []),
        });
        const mcp = makeMcpSource([config]);
        const capture = mcpActionContext({
            appAgentProviderSetController: noopHost,
            source: api,
            mcpSource: mcp.api,
        });
        await getHandler(api, "uninstall").run(capture.context, {
            args: { name: "echo" },
            flags: { type: "mcp" },
        } as any);
        expect(cleaned).toEqual([["owned-root"]]);
    });

    it("supports trust and enable transitions", async () => {
        const config = makeMcpConfig("echo");
        const { api } = makeSource();
        const mcp = makeMcpSource([config]);
        const context = mcpActionContext({
            appAgentProviderSetController: noopHost,
            source: api,
            mcpSource: mcp.api,
        }).context;
        await getMcpHandler(api, "trust").run(context, {
            args: { name: "echo" },
        } as any);
        await getMcpHandler(api, "enable").run(context, {
            args: { name: "echo" },
        } as any);
        expect(mcp.servers.get(config.id)).toMatchObject({
            trust: "trusted",
            enabled: true,
        });
    });

    it("confirms an untrusted one-shot test without changing trust", async () => {
        const config = makeMcpConfig("echo");
        const { api } = makeSource();
        const mcp = makeMcpSource([config]);
        const capture = mcpActionContext({
            appAgentProviderSetController: noopHost,
            source: api,
            mcpSource: mcp.api,
        });
        await getMcpHandler(api, "test").run(capture.context, {
            args: { name: "echo" },
        } as any);
        expect(mcp.calls).toContain(`test:${config.id}:true`);
        expect(mcp.servers.get(config.id)?.trust).toBe("untrusted");
        expect(capture.output()).toContain("Tools: echo");
    });

    it("completes type flags and MCP names", async () => {
        const config = makeMcpConfig("echo");
        const { api } = makeSource();
        const mcp = makeMcpSource([config]);
        const session = fakeSessionContext({
            appAgentProviderSetController: noopHost,
            source: api,
            mcpSource: mcp.api,
        });
        const install = await getHandler(api, "install").getCompletion!(
            session,
            {} as any,
            ["--type"],
        );
        expect(install.groups[0].completions).toEqual(["agent", "mcp", "all"]);
        const trust = await getMcpHandler(api, "trust").getCompletion!(
            session,
            {} as any,
            ["name"],
        );
        expect(trust.groups[0].completions).toEqual(["echo"]);
    });
});
