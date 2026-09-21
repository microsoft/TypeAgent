// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
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

const allowed = [
    ["list", "listLists"],
    ["list", "getList"],
    ["weather", "getCurrentConditions"],
    ["weather", "getForecast"],
    ["player", "listDevices"],
    ["player", "showSelectedDevice"],
    ["github-cli", "prFiles"],
    ["timer", "listReminders"],
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
    const scope = {};
    const externalExecute = jest.fn<NonNullable<AppAgent["executeAction"]>>();
    const setup = jest.fn<NonNullable<AppAgent["setup"]>>();

    beforeEach(async () => {
        directory = await fs.mkdtemp(path.join(os.tmpdir(), "ta-read-policy-"));
        storage = getFsStorageProvider().getStorage("list", directory);
        await storage.write("lists.json", seed);
        jest.spyOn(storage, "write");
        executionAllowed = true;
        readiness = { state: "ready" };
        externalExecute.mockReset().mockImplementation(async () => {
            throw new Error(
                "External handler must not execute in this fixture",
            );
        });
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
                // Only discovery and the pre-handler confirmation gate are
                // exercised for Spotify/GitHub here, never auth or live I/O.
                return { executeAction: externalExecute };
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
        parameters: Record<string, unknown> = {},
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
            parameters,
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

    it("keeps the rationale table synchronized with exact production declarations", async () => {
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
        const document = await fs.readFile(
            new URL(
                "../../../../../docs/architecture/read-only-action-policies.md",
                import.meta.url,
            ),
            "utf8",
        );
        const rows = [
            ...document.matchAll(
                /^\|[^|]+\|[ \t]+`([^`]+)`[ \t]+\|([^|]+)\|$/gm,
            ),
        ];
        expect(rows.map((row) => row[1]).sort()).toEqual(declared);
        for (const row of rows) expect(row[2].trim()).toMatch(/\.$/);
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
        for (const name of agentNames) {
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

    it.each([
        ["list", "addItems", { listName: "groceries", items: ["bread"] }],
        ["player", "setVolume", { newVolumeLevel: 50 }],
        [
            "github-cli",
            "prFailedChecks",
            { repo: "microsoft/TypeAgent", number: 2991 },
        ],
        ["timer", "cancelReminder", { id: "all" }],
        ["weather", "getAlerts", { location: "Seattle" }],
    ] as const)(
        "still confirms %s.%s before entering its handler",
        async (schemaName, actionName, parameters) => {
            const result = await dispatcher.executeAction(
                await request(schemaName, actionName, parameters),
            );
            expect(requirePrompt(result).prompt.type).toBe("confirmation");
            await cancel(result);
            expect(externalExecute).not.toHaveBeenCalled();
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
