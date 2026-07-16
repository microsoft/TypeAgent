// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgentProviderSetController } from "agent-dispatcher";
import {
    buildPackageCommandTable,
    createPackageAppAgentProvider,
    InstalledAgentSourceApi,
    PackageAgentContext,
    PACKAGE_AGENT_NAME,
} from "../src/installSources/packageAgent.js";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";

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
    return { context, output: () => captured.join("") };
}

function getHandler(
    source: InstalledAgentSourceApi,
    name: "install" | "uninstall" | "update" | "available" | "list",
): CommandHandler {
    const table = buildPackageCommandTable(source.sourceCommands());
    return table.commands[name] as CommandHandler;
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
                    ref: "k1",
                    defaultAgentName: "catalog-agent",
                    packageName: "@x/catalog-agent",
                },
                {
                    source: "feed",
                    ref: "@x/feed-agent",
                    defaultAgentName: "feed-agent",
                    packageName: "@x/feed-agent",
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
                            ref: "k1",
                            defaultAgentName: "catalog-agent",
                            packageName: "@x/catalog-agent",
                        },
                    ];
                }
                return [
                    {
                        source: "catalog",
                        ref: "k1",
                        defaultAgentName: "catalog-agent",
                        packageName: "@x/catalog-agent",
                    },
                    {
                        source: "feed",
                        ref: "@x/feed-agent",
                        defaultAgentName: "feed-agent",
                        packageName: "@x/feed-agent",
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
                { name: "a", source: "path" },
                { name: "b", source: "feed" },
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
    it("renders available agents (name, package, source) in sorted order", async () => {
        const { api } = makeSource({
            listAvailableAgents: async () => [
                {
                    source: "feed",
                    ref: "@x/zeta",
                    defaultAgentName: "zeta",
                    packageName: "@x/zeta",
                },
                {
                    source: "catalog",
                    ref: "k-alpha",
                    defaultAgentName: "alpha",
                    packageName: "alpha-pkg",
                },
                {
                    source: "feed",
                    ref: "@x/beta",
                    defaultAgentName: "beta",
                    packageName: "@x/beta",
                },
            ],
        });
        const handler = getHandler(api, "available");
        const { context, output } = capturingActionContext({
            appAgentProviderSetController: noopHost,
            source: api,
        });
        await handler.run(context, { args: {}, flags: {} } as any);
        const text = output();
        expect(text).toContain("Name Package Source");
        expect(text).toContain("alpha alpha-pkg catalog");
        expect(text).toContain("beta @x/beta feed");
        expect(text).toContain("zeta @x/zeta feed");
        expect(text.indexOf("alpha")).toBeLessThan(text.indexOf("beta"));
        expect(text.indexOf("beta")).toBeLessThan(text.indexOf("zeta"));
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
                            ref: "k-alpha",
                            defaultAgentName: "alpha",
                            packageName: "alpha-pkg",
                        },
                    ];
                }
                return [
                    {
                        source: "catalog",
                        ref: "k-alpha",
                        defaultAgentName: "alpha",
                        packageName: "alpha-pkg",
                    },
                    {
                        source: "feed",
                        ref: "@x/beta",
                        defaultAgentName: "beta",
                        packageName: "@x/beta",
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
        expect(text).toContain("alpha alpha-pkg catalog");
        expect(text).not.toContain("beta @x/beta feed");
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
    it("renders headings, tables, and footer with explicit line breaks", async () => {
        const { api } = makeSource({
            listInstalled: () => [
                { name: "beta", source: "feed", ref: "pkg-beta" },
                { name: "alpha", source: "catalog", ref: "pkg-alpha" },
            ],
        });
        const handler = getHandler(api, "list");
        const { context, output } = tightlyCapturingActionContext({
            appAgentProviderSetController: noopHost,
            source: api,
        });

        await handler.run(context, { args: {} } as any);

        expect(output()).toContain(
            "catalog\nAgent Reference\nalpha pkg-alpha\nfeed\nAgent Reference\nbeta pkg-beta\nShowing installable installed agents only.",
        );
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
