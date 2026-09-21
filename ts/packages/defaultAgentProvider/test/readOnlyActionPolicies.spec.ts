// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import * as childProcess from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
    AppAgent,
    AppAgentManifest,
    ReadinessReport,
    Storage,
} from "@typeagent/agent-sdk";
import type {
    AppAgentProvider,
    Dispatcher,
    ExecuteActionRequest,
    StructuredActionExecutionResult,
} from "agent-dispatcher";
import {
    closeCommandHandlerContext,
    createDispatcherFromContext,
    initializeCommandHandlerContext,
    type CommandHandlerContext,
} from "agent-dispatcher/internal";
import { getFsStorageProvider } from "dispatcher-node-providers";
import { instantiate as instantiateList } from "@typeagent/list-agent/agent/handlers";
import { instantiate as instantiateTimer } from "@typeagent/timer-agent/agent/handlers";
import { instantiate as instantiateWeather } from "@typeagent/weather-agent/agent/handlers";
import { getDefaultAppAgentProviders } from "../src/defaultAgentProviders.js";

const runCli =
    jest.fn<
        (
            command: string,
            args: readonly string[],
            options: unknown,
        ) => Promise<{ stdout: string; stderr: string }>
    >();
const execFile = Object.assign(
    () => {
        throw new Error("Unexpected callback-based subprocess invocation");
    },
    { [promisify.custom]: runCli },
);
// Mock only transport; policies, validation, readiness, handlers and choices
// are the production implementations.
for (const module of ["node:child_process", "child_process"]) {
    jest.unstable_mockModule(module, () => ({ ...childProcess, execFile }));
}
const { instantiate: instantiateGitHub } = await import(
    "@typeagent/github-cli-agent/agent/handlers"
);
const { instantiate: instantiateIpconfig } = await import(
    "@typeagent/ipconfig-agent/agent/handlers"
);
const { instantiate: instantiateLocalPlayer } = await import(
    "@typeagent/music-local/agent/handlers"
);
const { instantiate: instantiatePowerShell } = await import(
    "@typeagent/powershell-typeagent/agent/handlers"
);
const { instantiate: instantiateTaskflow } = await import(
    "@typeagent/taskflow-typeagent/agent/handlers"
);

const allowed = [
    ["list", "listLists"],
    ["list", "getList"],
    ["weather", "getCurrentConditions"],
    ["weather", "getForecast"],
    ["ipconfig", "displayHelpMessage"],
    ["ipconfig", "displayFullConfigurationInformation"],
    ["ipconfig", "displayDNSResolverCacheContents"],
    ["github-cli", "prFiles"],
    ["github-cli", "codespaceList"],
    ["github-cli", "gistList"],
    ["github-cli", "orgList"],
    ["github-cli", "cacheList"],
    ["github-cli", "issueList"],
    ["github-cli", "issueView"],
    ["github-cli", "prList"],
    ["github-cli", "prView"],
    ["github-cli", "prMergedStatus"],
    ["github-cli", "prChecks"],
    ["github-cli", "releaseList"],
    ["timer", "listReminders"],
    ["localPlayer", "status"],
    ["localPlayer", "showQueue"],
    ["localPlayer", "showMusicFolder"],
    ["powershell", "listPowerShellFlows"],
    ["taskflow", "listTaskFlows"],
] as const;
const agentNames = [...new Set(allowed.map(([name]) => name))];
const seed = JSON.stringify([
    { name: "groceries", items: ["milk", "eggs"] },
    { name: "packing", items: ["coat"] },
    { name: "empty", items: [] },
]);

function requirePrompt(result: StructuredActionExecutionResult) {
    if (result.status !== "requires_interaction") {
        throw new Error(`Expected interaction, got ${result.status}`);
    }
    return result;
}

describe("built-in read-only action policies", () => {
    let context: CommandHandlerContext;
    let dispatcher: Dispatcher;
    let directory: string;
    let storage: Storage;
    let manifests: Map<string, AppAgentManifest>;
    let executionAllowed: boolean;
    let readiness: ReadinessReport;
    let listAgent: AppAgent;
    let agentStorage: Map<string, Storage>;
    const scope = {};
    const setup = jest.fn<NonNullable<AppAgent["setup"]>>();

    beforeEach(async () => {
        directory = await fs.mkdtemp(path.join(os.tmpdir(), "ta-read-policy-"));
        storage = getFsStorageProvider().getStorage("list", directory);
        await storage.write("lists.json", seed);
        jest.spyOn(storage, "write");
        executionAllowed = true;
        readiness = { state: "ready" };
        runCli.mockReset().mockImplementation(async (command, args) => {
            if (command === "gh" && args.join(" ") === "auth status") {
                return { stdout: "Authenticated test account", stderr: "" };
            }
            throw new Error(
                `Unexpected subprocess: ${command} ${args.join(" ")}`,
            );
        });
        agentStorage = new Map();
        setup.mockReset();
        const bundled = getDefaultAppAgentProviders(undefined)[0];
        manifests = new Map(
            await Promise.all(
                agentNames.map(
                    async (name) =>
                        [
                            name,
                            await bundled.getAppAgentManifest(name),
                        ] as const,
                ),
            ),
        );
        listAgent = instantiateList();
        const provider: AppAgentProvider = {
            getAppAgentNames: () => agentNames,
            getAppAgentManifest: async (name) => {
                const manifest = manifests.get(name);
                if (!manifest) throw new Error(`Missing manifest: ${name}`);
                return manifest;
            },
            loadAppAgent: async (name) => {
                if (name === "list") {
                    return {
                        ...listAgent,
                        executeAction: (action, actionContext) =>
                            listAgent.executeAction!(action, actionContext),
                        checkReadiness: async () => readiness,
                        setup,
                        updateAgentContext: (enable, session, schemaName) =>
                            listAgent.updateAgentContext!(
                                enable,
                                { ...session, sessionStorage: storage },
                                schemaName,
                            ),
                    };
                }
                if (name === "timer") return instantiateTimer();
                if (name === "weather") return instantiateWeather();
                if (name === "github-cli") return instantiateGitHub();
                if (name === "ipconfig") return instantiateIpconfig();
                const factories: Record<string, () => AppAgent> = {
                    localPlayer: instantiateLocalPlayer,
                    powershell: instantiatePowerShell,
                    taskflow: instantiateTaskflow,
                };
                const agent = factories[name]?.();
                if (!agent) throw new Error(`Unexpected agent: ${name}`);
                const isolated = getFsStorageProvider().getStorage(
                    name,
                    directory,
                );
                agentStorage.set(name, isolated);
                jest.spyOn(isolated, "write");
                return {
                    ...agent,
                    updateAgentContext: (enable, session, schemaName) =>
                        agent.updateAgentContext!(
                            enable,
                            {
                                ...session,
                                instanceStorage: isolated,
                                sessionStorage: isolated,
                            },
                            schemaName,
                        ),
                };
            },
            unloadAppAgent: async () => {},
        };
        context = await initializeCommandHandlerContext("read-policy-test", {
            appAgentProviders: [provider],
            agents: agentNames,
            translation: { enabled: false },
            explainer: { enabled: false },
            cache: { enabled: false },
            dblogging: false,
            conversationMemorySettings: {
                requestKnowledgeExtraction: false,
                actionResultEntityStorage: false,
                actionResultKnowledgeExtraction: false,
            },
        });
        dispatcher = createDispatcherFromContext(
            context,
            "policy-test",
            undefined,
            () => ({
                scope,
                canDiscoverSchema: () => true,
                canExecute: executionAllowed,
                isActive: () => true,
            }),
        );
        runCli.mockClear();
        for (const isolated of agentStorage.values()) {
            jest.mocked(isolated.write).mockClear();
        }
    });

    afterEach(async () => {
        try {
            await closeCommandHandlerContext(context);
        } finally {
            jest.restoreAllMocks();
            await fs.rm(directory, { recursive: true, force: true });
        }
    });

    async function request(
        schemaName: string,
        actionName: string,
        parameters?: Record<string, unknown>,
    ): Promise<ExecuteActionRequest> {
        const search = await dispatcher.searchActions({
            query: `${schemaName} ${actionName}`,
        });
        expect(search.actions).toEqual([
            expect.objectContaining({ schemaName, actionName }),
        ]);
        return {
            protocolVersion: 1,
            scopeId: search.scopeId,
            schemaName,
            actionName,
            ...(parameters === undefined &&
            (schemaName === "localPlayer" ||
                schemaName === "powershell" ||
                schemaName === "taskflow")
                ? {}
                : { parameters: parameters ?? {} }),
        };
    }

    async function cancel(
        result: StructuredActionExecutionResult,
        status: "cancelled" | "execution_uncertain" = "cancelled",
    ) {
        const prompt = requirePrompt(result);
        expect(
            (
                await dispatcher.cancelAction({
                    protocolVersion: 1,
                    scopeId: prompt.scopeId,
                    operationId: prompt.operationId,
                    interactionId: prompt.interactionId,
                })
            ).status,
        ).toBe(status);
    }

    it("matches the audited exact allowlist to valid production declarations", () => {
        const declared = [];
        for (const [name, manifest] of manifests) {
            for (const [actionName, policy] of Object.entries(
                manifest.schema?.actionPolicies ?? {},
            )) {
                expect(policy).toEqual({ effects: "read-only" });
                const config = context.agents.getActionConfig(name);
                const schema =
                    context.agents.getActionSchemaFileForConfig(config);
                expect(
                    schema.parsedActionSchema.actionSchemas.has(actionName),
                ).toBe(true);
                declared.push(`${name}.${actionName}`);
            }
        }
        expect(declared.sort()).toEqual(
            allowed.map(([name, action]) => `${name}.${action}`).sort(),
        );
        expect(declared).toHaveLength(25);
        expect(agentNames).toHaveLength(8);
    });

    it.each(allowed)(
        "discovers %s.%s as read-only without outer confirmation",
        async (schemaName, actionName) => {
            const result = await dispatcher.searchActions({
                query: `${schemaName} ${actionName}`,
            });
            expect(result.actions).toEqual([
                expect.objectContaining({
                    schemaName,
                    actionName,
                    policy: {
                        effects: "read-only",
                        confirmation: "not-required",
                    },
                    interactions: expect.objectContaining({
                        mode: "may-require-interaction",
                    }),
                }),
            ]);
        },
    );

    it("leaves every unclassified sibling requiring confirmation", async () => {
        const schemaNames = agentNames.flatMap((name) => [
            name,
            ...Object.keys(manifests.get(name)?.subActionManifests ?? {}).map(
                (child) => `${name}.${child}`,
            ),
        ]);
        for (const name of schemaNames) {
            const config = context.agents.getActionConfig(name);
            const schema = context.agents.getActionSchemaFileForConfig(config);
            for (const actionName of schema.parsedActionSchema.actionSchemas.keys()) {
                if (config.actionPolicies?.[actionName]) continue;
                const result = await dispatcher.searchActions({
                    query: `${name} ${actionName}`,
                });
                expect(result.actions[0]?.policy).toEqual({
                    effects: "unknown",
                    confirmation: "required",
                });
            }
        }
    });

    it("executes real list reads and reuses the contract with different parameters without writes", async () => {
        const inventory = await dispatcher.executeAction(
            await request("list", "listLists"),
        );
        expect(inventory.status).toBe("completed");
        expect(inventory.results[0].result).toMatchObject({
            entities: [
                { name: "groceries" },
                { name: "packing" },
                { name: "empty" },
            ],
        });
        const input = await request("list", "getList", {
            listName: "groceries",
        });
        for (const [listName, items] of [
            ["groceries", ["milk", "eggs"]],
            ["packing", ["coat"]],
            ["empty", []],
        ] as const) {
            const result = await dispatcher.executeAction({
                ...input,
                parameters: { listName },
            });
            expect(result.status).toBe("completed");
            expect(result.results[0].result).toMatchObject({
                displayContent: { rawData: { name: listName, items } },
            });
        }
        const missing = await dispatcher.executeAction({
            ...input,
            parameters: { listName: "missing" },
        });
        expect(missing.status).toBe("failed");
        expect(await storage.read("lists.json", "utf8")).toBe(seed);
        expect(storage.write).not.toHaveBeenCalled();
    });

    it("executes real weather handlers using only mocked fixed-endpoint reads", async () => {
        const fetch = jest
            .spyOn(globalThis, "fetch")
            .mockImplementation(async (input, init) => {
                expect(init?.method ?? "GET").toBe("GET");
                const url = new URL(String(input));
                if (url.hostname === "geocoding-api.open-meteo.com") {
                    expect(url.pathname).toBe("/v1/search");
                    return Response.json({
                        results: [
                            {
                                latitude: 47.6,
                                longitude: -122.3,
                                name: "Seattle",
                            },
                        ],
                    });
                }
                expect(url.origin + url.pathname).toBe(
                    "https://api.open-meteo.com/v1/forecast",
                );
                return Response.json({
                    current: {
                        temperature_2m: 55,
                        apparent_temperature: 54,
                        weather_code: 0,
                        relative_humidity_2m: 50,
                        wind_speed_10m: 3,
                        wind_direction_10m: 90,
                    },
                    daily: {
                        time: ["2026-09-20"],
                        temperature_2m_max: [60],
                        temperature_2m_min: [45],
                        weather_code: [0],
                        precipitation_probability_max: [10],
                    },
                });
            });
        for (const actionName of ["getCurrentConditions", "getForecast"]) {
            const result = await dispatcher.executeAction(
                await request("weather", actionName, {
                    location: "Seattle",
                    ...(actionName === "getForecast" ? { days: 1 } : {}),
                }),
            );
            expect(result.status).toBe("completed");
            expect(result.results[0].result).toMatchObject({
                displayContent: { rawData: { location: "Seattle" } },
            });
        }
        expect(fetch).toHaveBeenCalledTimes(4);
    });

    it("executes the real empty reminder inventory without scheduling anything", async () => {
        const result = await dispatcher.executeAction(
            await request("timer", "listReminders"),
        );
        expect(result.status).toBe("completed");
        expect(result.results[0].result).toMatchObject({
            displayContent: "No pending reminders.",
        });
    });

    it("executes every exempt GitHub list/view branch through mocked CLI transport", async () => {
        const cases: [string, Record<string, unknown>, string[]][] = [
            ["codespaceList", {}, ["codespace", "list"]],
            ["gistList", {}, ["gist", "list"]],
            ["gistList", { public: true }, ["gist", "list", "--public"]],
            ["orgList", {}, ["org", "list"]],
            ["cacheList", {}, ["cache", "list"]],
            ["releaseList", {}, ["release", "list"]],
            [
                "releaseList",
                { repo: "owner/repo" },
                ["release", "list", "--repo", "owner/repo"],
            ],
            [
                "issueView",
                { number: 42, repo: "owner/repo" },
                [
                    "issue",
                    "view",
                    "42",
                    "--repo",
                    "owner/repo",
                    "--json",
                    "number,title,state,body,author,labels,assignees,comments,url,createdAt,closedAt",
                ],
            ],
            [
                "prView",
                { number: 42, repo: "owner/repo" },
                [
                    "pr",
                    "view",
                    "42",
                    "--repo",
                    "owner/repo",
                    "--json",
                    "number,title,state,body,author,labels,url,createdAt,headRefName,baseRefName,isDraft,additions,deletions,changedFiles",
                ],
            ],
            [
                "prChecks",
                { number: 42, repo: "owner/repo" },
                ["pr", "checks", "42", "--repo", "owner/repo"],
            ],
            [
                "prMergedStatus",
                { branch: "--web" },
                [
                    "pr",
                    "list",
                    "--head",
                    "--web",
                    "--state",
                    "merged",
                    "--limit",
                    "20",
                    "--json",
                    "number,title,url,mergedAt,headRefName,baseRefName",
                ],
            ],
            [
                "prMergedStatus",
                {
                    branch: "feature",
                    base: "main",
                    repo: "owner/repo",
                    limit: 3,
                },
                [
                    "pr",
                    "list",
                    "--repo",
                    "owner/repo",
                    "--base",
                    "main",
                    "--head",
                    "feature",
                    "--state",
                    "merged",
                    "--limit",
                    "3",
                    "--json",
                    "number,title,url,mergedAt,headRefName,baseRefName",
                ],
            ],
        ];
        for (const kind of ["issue", "pr"]) {
            const fields =
                kind === "issue"
                    ? "number,title,state,url,createdAt,labels"
                    : "number,title,state,url,createdAt,headRefName,isDraft";
            cases.push([`${kind}List`, {}, [kind, "list", "--json", fields]]);
            for (const assignee of ["none", "octocat"]) {
                cases.push([
                    `${kind}List`,
                    {
                        repo: "owner/repo",
                        state: "open",
                        label: "--web",
                        author: "@me",
                        assignee,
                        limit: 3,
                    },
                    [
                        kind,
                        "list",
                        "--repo",
                        "owner/repo",
                        "--state",
                        "open",
                        "--label",
                        "--web",
                        "--author",
                        "@me",
                        ...(assignee === "none"
                            ? ["--search", "no:assignee"]
                            : ["--assignee", assignee]),
                        "--limit",
                        "3",
                        "--json",
                        fields,
                    ],
                ]);
            }
        }
        for (const [actionName, parameters, args] of cases) {
            runCli.mockClear().mockResolvedValue({
                stdout:
                    actionName === "issueView" || actionName === "prView"
                        ? JSON.stringify({
                              number: 42,
                              title: "Read fixture",
                              state: "OPEN",
                              body: "",
                              author: { login: "octocat" },
                              labels: [],
                              assignees: [],
                              comments: [],
                              url: "https://github.com/owner/repo/pull/42",
                          })
                        : args.includes("--json")
                          ? "[]"
                          : "Inventory fixture",
                stderr: "",
            });
            const result = await dispatcher.executeAction(
                await request("github-cli", actionName, parameters),
            );
            expect(result.status).toBe("completed");
            expect(result.results[0].result).toHaveProperty("displayContent");
            expect(runCli).toHaveBeenCalledTimes(1);
            expect(runCli).toHaveBeenCalledWith(
                "gh",
                args,
                expect.objectContaining({
                    timeout: 30_000,
                    maxBuffer: 1024 * 1024,
                }),
            );
        }
    });

    it("executes real bounded PR file reads with and without patch excerpts", async () => {
        for (const includePatch of [false, true]) {
            runCli
                .mockClear()
                .mockResolvedValueOnce({
                    stdout: JSON.stringify({
                        number: 42,
                        title: "Read fixture",
                        state: "OPEN",
                        url: "https://github.com/owner/repo/pull/42",
                        changedFiles: 1,
                        additions: 1,
                        deletions: 0,
                    }),
                    stderr: "",
                })
                .mockResolvedValueOnce({
                    stdout: JSON.stringify([
                        {
                            filename: "file.ts",
                            status: "modified",
                            additions: 1,
                            deletions: 0,
                            changes: 1,
                            ...(includePatch ? { patch: "+new line" } : {}),
                        },
                    ]),
                    stderr: "",
                });
            const result = await dispatcher.executeAction(
                await request("github-cli", "prFiles", {
                    number: 42,
                    repo: "owner/repo",
                    includePatch,
                    maxFiles: 1,
                    maxPatchLines: 1,
                }),
            );
            expect(result.status).toBe("completed");
            expect(result.results[0].result).toMatchObject({
                displayContent: {
                    rawData: {
                        kind: "prFiles",
                        repo: "owner/repo",
                        number: 42,
                        files: [
                            expect.objectContaining({
                                path: "file.ts",
                                ...(includePatch ? { patch: "+new line" } : {}),
                            }),
                        ],
                    },
                },
            });
            expect(
                runCli.mock.calls.map(([command, args]) => [command, args]),
            ).toEqual([
                [
                    "gh",
                    [
                        "pr",
                        "view",
                        "42",
                        "--repo",
                        "owner/repo",
                        "--json",
                        "number,title,url,state,isDraft,additions,deletions,changedFiles,headRefName,baseRefName,headRepository,headRepositoryOwner",
                    ],
                ],
                [
                    "gh",
                    [
                        "api",
                        "--hostname",
                        "github.com",
                        "repos/owner/repo/pulls/42/files?per_page=2&page=1",
                        ...(includePatch
                            ? []
                            : [
                                  "--jq",
                                  "[.[] | {filename, status, additions, deletions, changes, previous_filename}]",
                              ]),
                    ],
                ],
            ]);
        }
    });

    it("keeps bare repository names literal and preserves the real repository-choice prompt", async () => {
        for (const repo of ["TypeAgent", "--web", "-w"]) {
            runCli.mockClear().mockResolvedValue({
                stdout: JSON.stringify([
                    { name: "TypeAgent", owner: { login: "microsoft" } },
                ]),
                stderr: "",
            });
            const result = await dispatcher.executeAction(
                await request("github-cli", "prFiles", { repo, number: 2991 }),
            );
            expect(requirePrompt(result).prompt).toMatchObject({
                type: "multiChoice",
                message: expect.stringContaining("Pick the repo"),
            });
            expect(runCli).toHaveBeenCalledTimes(1);
            expect(runCli).toHaveBeenCalledWith(
                "gh",
                [
                    "search",
                    "repos",
                    "--limit",
                    "5",
                    "--json",
                    "name,owner",
                    "--",
                    repo,
                ],
                expect.anything(),
            );
            await cancel(result, "execution_uncertain");
        }
    });

    it("keeps GitHub reads unavailable when the real auth probe fails without invoking setup", async () => {
        const input = await request("github-cli", "orgList");
        runCli.mockRejectedValue({ code: 1, stderr: "Not authenticated" });
        await context.agents.refreshReadiness("github-cli");
        expect((await dispatcher.executeAction(input)).status).toBe(
            "unavailable",
        );
        expect(
            runCli.mock.calls.map(([command, args]) => [command, args]),
        ).toEqual([["gh", ["auth", "status"]]]);
    });

    it("executes the three fixed Windows inventory commands without a shell or network mutation", async () => {
        runCli.mockResolvedValue({
            stdout: "Windows IP Configuration\n\n   Host Name . . . . . : fixture",
            stderr: "",
        });
        for (const [actionName, flag] of [
            ["displayHelpMessage", "/?"],
            ["displayFullConfigurationInformation", "/all"],
            ["displayDNSResolverCacheContents", "/displaydns"],
        ]) {
            runCli.mockClear();
            const result = await dispatcher.executeAction(
                await request("ipconfig", actionName),
            );
            expect(result.status).toBe("completed");
            expect(result.results[0].result).toHaveProperty("displayContent");
            expect(runCli).toHaveBeenCalledTimes(1);
            expect(runCli).toHaveBeenCalledWith("ipconfig", [flag], {
                timeout: 30_000,
            });
        }
    });

    it("reads real local-player state without playback, file scans, or storage writes", async () => {
        for (const [actionName, text] of [
            ["status", "No track loaded"],
            ["showQueue", "Queue is empty"],
            ["showMusicFolder", "Music folder"],
        ]) {
            const result = await dispatcher.executeAction(
                await request("localPlayer", actionName),
            );
            expect(result.status).toBe("completed");
            expect(JSON.stringify(result.results[0].result)).toContain(text);
        }
        expect(agentStorage.get("localPlayer")!.write).not.toHaveBeenCalled();
        expect(runCli).not.toHaveBeenCalled();
    });

    it("lists real registered flows without running scripts or updating their indexes", async () => {
        for (const [schemaName, actionName] of [
            ["powershell", "listPowerShellFlows"],
            ["taskflow", "listTaskFlows"],
        ]) {
            const isolated = agentStorage.get(schemaName)!;
            const before = await isolated.read("index.json", "utf8");
            const result = await dispatcher.executeAction(
                await request(schemaName, actionName),
            );
            expect(result.status).toBe("completed");
            expect(result.results[0].result).toHaveProperty("displayContent");
            expect(JSON.stringify(result.results[0].result)).not.toContain(
                "store not available",
            );
            expect(isolated.write).not.toHaveBeenCalled();
            expect(await isolated.read("index.json", "utf8")).toBe(before);
        }
        expect(runCli).not.toHaveBeenCalled();
    });

    it.each([
        ["list", "addItems", { listName: "groceries", items: ["bread"] }],
        ["ipconfig", "purgeDNSResolverCache", {}],
        [
            "github-cli",
            "prFailedChecks",
            { repo: "microsoft/TypeAgent", number: 2991 },
        ],
        ["timer", "cancelReminder", { id: "all" }],
        ["weather", "getAlerts", { location: "Seattle" }],
        ["localPlayer", "pause", undefined],
        ["powershell", "deletePowerShellFlow", { name: "fixture" }],
        ["taskflow", "deleteTaskFlow", { name: "fixture" }],
    ] as const)(
        "still confirms %s.%s before entering its handler",
        async (schemaName, actionName, parameters) => {
            const result = await dispatcher.executeAction(
                await request(schemaName, actionName, parameters),
            );
            expect(requirePrompt(result).prompt.type).toBe("confirmation");
            await cancel(result);
            expect(runCli).not.toHaveBeenCalled();
            expect(storage.write).not.toHaveBeenCalled();
        },
    );

    it("rechecks an explicit required override after discovery", async () => {
        const input = await request("list", "getList", {
            listName: "groceries",
        });
        context.agents.getActionConfig("list").actionPolicies = {
            getList: { effects: "read-only", confirmation: "required" },
        };
        const result = await dispatcher.executeAction(input);
        expect(requirePrompt(result).prompt.type).toBe("confirmation");
        await cancel(result);
        expect(storage.write).not.toHaveBeenCalled();
    });

    it("preserves validation, authorization, and readiness for a real read action", async () => {
        const input = await request("list", "getList", {
            listName: "groceries",
        });
        const execute = jest.spyOn(listAgent, "executeAction");
        expect(
            await dispatcher.executeAction({
                ...input,
                parameters: { listName: 42 },
            }),
        ).toMatchObject({
            status: "failed",
            error: {
                code: "execution_failed",
                message: expect.stringContaining("listName"),
            },
        });
        executionAllowed = false;
        expect((await dispatcher.executeAction(input)).status).toBe(
            "unavailable",
        );
        executionAllowed = true;
        readiness = {
            state: "setup-required",
            message: "Offline prerequisite unavailable",
        };
        await context.agents.refreshReadiness("list");
        expect((await dispatcher.executeAction(input)).status).toBe(
            "unavailable",
        );
        expect(execute).not.toHaveBeenCalled();
        expect(setup).not.toHaveBeenCalled();
    });

    it("rechecks availability when list actions are disabled after discovery", async () => {
        const input = await request("list", "getList", {
            listName: "groceries",
        });
        const execute = jest.spyOn(listAgent, "executeAction");
        const settings = context.session.getConfig();
        await context.agents.setState(context, {
            ...settings,
            actions: { ...settings.actions, list: false },
        });
        expect((await dispatcher.executeAction(input)).status).toBe(
            "unavailable",
        );
        expect(execute).not.toHaveBeenCalled();
        expect(storage.write).not.toHaveBeenCalled();
    });

    it("preserves the real list handler's separate deletion question", async () => {
        const outer = requirePrompt(
            await dispatcher.executeAction(
                await request("list", "deleteList", { listName: "groceries" }),
            ),
        );
        expect(outer.prompt.type).toBe("confirmation");
        const inner = await dispatcher.continueAction({
            protocolVersion: 1,
            scopeId: outer.scopeId,
            operationId: outer.operationId,
            interactionId: outer.interactionId,
            response: { type: "confirmation", approved: true },
        });
        expect(requirePrompt(inner).prompt).toMatchObject({
            type: "yesNo",
            message: "Delete list 'groceries'? This cannot be undone.",
        });
        await cancel(inner, "execution_uncertain");
        expect(await storage.read("lists.json", "utf8")).toBe(seed);
        expect(storage.write).not.toHaveBeenCalled();
    });
});
