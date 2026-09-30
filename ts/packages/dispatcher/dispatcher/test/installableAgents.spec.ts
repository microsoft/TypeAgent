// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    findDisabledAgents,
    findInstallableAgents,
    findAgentAvailabilityOptions,
    formatAgentAvailabilityOptions,
    formatInstallableAgents,
    getReasoningActionSchemas,
} from "../src/reasoning/installableAgents.js";
import type { CommandHandlerContext } from "../src/context/commandHandlerContext.js";
import type {
    AppAgentSource,
    InstallableAgentSummary,
} from "../src/agentProvider/agentProvider.js";
import type { ActionConfig } from "../src/translation/actionConfig.js";

function summary(
    installName: string,
    source: string,
    description?: string,
): InstallableAgentSummary {
    return {
        installName,
        packageName: `@typeagent/${installName}-agent`,
        ...(description !== undefined ? { description } : {}),
        source,
        installCommand: `@package install ${installName}`,
    };
}

// Build a minimal CommandHandlerContext exposing fields needed by tests.
function fakeContext(
    sources: AppAgentSource[] = [],
    presentAgentNames: string[] = [],
    options: {
        actionConfigs?: Partial<ActionConfig>[];
        schemasConfig?: Record<string, boolean>;
        actionsConfig?: Record<string, boolean>;
        loadingSchemas?: string[];
        loadErrors?: Record<string, Error>;
        readiness?: Record<string, { state: string }>;
        descriptions?: Record<string, string>;
        activeSchemas?: string[];
        activeActions?: string[];
        actionSchemasCount?: Record<string, number>;
        throwingSchemas?: string[];
    } = {},
): CommandHandlerContext {
    const actionConfigs = (options.actionConfigs ?? []).map((cfg) => ({
        schemaName: cfg.schemaName ?? "sample",
        description: cfg.description,
        schemaDefaultEnabled: cfg.schemaDefaultEnabled ?? true,
        actionDefaultEnabled: cfg.actionDefaultEnabled ?? true,
        ...cfg,
    })) as ActionConfig[];

    const activeSchemas = options.activeSchemas ?? [];
    const activeActions = options.activeActions ?? activeSchemas;
    const loadingSchemas = new Set(options.loadingSchemas ?? []);
    const loadErrors = new Map(Object.entries(options.loadErrors ?? {}));
    const readiness = new Map(Object.entries(options.readiness ?? {}));
    const descriptions = new Map(Object.entries(options.descriptions ?? {}));
    const actionSchemasCount = options.actionSchemasCount ?? {};
    const throwingSchemas = new Set(options.throwingSchemas ?? []);

    return {
        appAgentSources: sources,
        session: {
            getConfig: () => ({
                schemas: options.schemasConfig ?? {},
                actions: options.actionsConfig ?? {},
                commands: {},
            }),
        },
        agents: {
            getAppAgentNames: () => presentAgentNames,
            getSchemaNames: () => actionConfigs.map((c) => c.schemaName),
            getActionConfigs: () => actionConfigs,
            getActiveSchemas: () => activeSchemas,
            isSchemaActive: (name: string) => activeSchemas.includes(name),
            isActionActive: (name: string) => activeActions.includes(name),
            isSchemaLoading: (name: string) => loadingSchemas.has(name),
            getLoadError: (name: string) => loadErrors.get(name),
            getReadiness: (name: string) =>
                readiness.get(name) ?? { state: "ready" },
            getAppAgentDescription: (name: string) => descriptions.get(name),
            tryGetActionSchemaFile: (schemaName: string) => {
                if (throwingSchemas.has(schemaName)) {
                    throw new Error("schema parse failed");
                }
                const count = actionSchemasCount[schemaName] ?? 1;
                if (count === 0) {
                    return undefined;
                }
                const map = new Map<string, unknown>();
                for (let i = 0; i < count; i++) {
                    map.set(`action${i}`, {});
                }
                return {
                    parsedActionSchema: {
                        actionSchemas: map,
                    },
                } as any;
            },
        },
    } as unknown as CommandHandlerContext;
}

function sourceReturning(agents: InstallableAgentSummary[]): AppAgentSource {
    return {
        connect: () => {
            throw new Error("connect not used in this test");
        },
        listAvailableAgents: async () => agents,
    };
}

describe("getReasoningActionSchemas", () => {
    it("returns schemas where both schema and action are active", () => {
        const ctx = fakeContext([], ["code", "player"], {
            activeSchemas: ["code", "player"],
            activeActions: ["player"], // code action is inactive
        });
        expect(getReasoningActionSchemas(ctx)).toEqual(["player"]);
    });
});

describe("findDisabledAgents", () => {
    it("discovers an agent with schemaDefaultEnabled: false", () => {
        const ctx = fakeContext([], ["code"], {
            actionConfigs: [
                {
                    schemaName: "code",
                    description: "Write and inspect code",
                    schemaDefaultEnabled: false,
                },
            ],
            descriptions: { code: "Coding agent" },
        });
        const disabled = findDisabledAgents(ctx);
        expect(disabled).toHaveLength(1);
        expect(disabled[0]).toEqual({
            agentName: "code",
            description: "Coding agent",
            disabledSchemas: [
                { schemaName: "code", description: "Write and inspect code" },
            ],
            enableCommand: "@config agent code",
        });
    });

    it("discovers an agent disabled via session configuration overrides", () => {
        const ctx = fakeContext([], ["player"], {
            actionConfigs: [
                {
                    schemaName: "player",
                    description: "Play music",
                    schemaDefaultEnabled: true,
                },
            ],
            schemasConfig: { player: false },
            descriptions: { player: "Music player" },
        });
        const disabled = findDisabledAgents(ctx);
        expect(disabled).toHaveLength(1);
        expect(disabled[0].agentName).toBe("player");
    });

    it("discovers an agent when action is disabled even if schema is enabled", () => {
        const ctx = fakeContext([], ["player"], {
            actionConfigs: [
                {
                    schemaName: "player",
                    schemaDefaultEnabled: true,
                    actionDefaultEnabled: true,
                },
            ],
            actionsConfig: { player: false },
        });
        const disabled = findDisabledAgents(ctx);
        expect(disabled).toHaveLength(1);
        expect(disabled[0].agentName).toBe("player");
    });

    it("excludes schemas that are still loading", () => {
        const ctx = fakeContext([], ["code"], {
            actionConfigs: [
                { schemaName: "code", schemaDefaultEnabled: false },
            ],
            loadingSchemas: ["code"],
        });
        expect(findDisabledAgents(ctx)).toEqual([]);
    });

    it("excludes agents with load errors", () => {
        const ctx = fakeContext([], ["code"], {
            actionConfigs: [
                { schemaName: "code", schemaDefaultEnabled: false },
            ],
            loadErrors: { code: new Error("Failed to load") },
        });
        expect(findDisabledAgents(ctx)).toEqual([]);
    });

    it("excludes unsupported agents", () => {
        const ctx = fakeContext([], ["osNotifications"], {
            actionConfigs: [
                { schemaName: "osNotifications", schemaDefaultEnabled: false },
            ],
            readiness: { osNotifications: { state: "unsupported" } },
        });
        expect(findDisabledAgents(ctx)).toEqual([]);
    });

    it("excludes empty and unloadable action schemas", () => {
        const empty = fakeContext([], ["empty"], {
            actionConfigs: [
                { schemaName: "empty", schemaDefaultEnabled: false },
            ],
            actionSchemasCount: { empty: 0 },
        });
        expect(findDisabledAgents(empty)).toEqual([]);

        const unloadable = fakeContext([], ["broken"], {
            actionConfigs: [
                { schemaName: "broken", schemaDefaultEnabled: false },
            ],
            throwingSchemas: ["broken"],
        });
        expect(findDisabledAgents(unloadable)).toEqual([]);
    });

    it("marks needsSetup for setup-required agents", () => {
        const ctx = fakeContext([], ["calendar"], {
            actionConfigs: [
                { schemaName: "calendar", schemaDefaultEnabled: false },
            ],
            readiness: { calendar: { state: "setup-required" } },
        });
        const disabled = findDisabledAgents(ctx);
        expect(disabled).toHaveLength(1);
        expect(disabled[0].needsSetup).toBe(true);
    });

    it("collapses multiple disabled sub-schemas to one agent summary", () => {
        const ctx = fakeContext([], ["desktop"], {
            actionConfigs: [
                {
                    schemaName: "desktop",
                    description: "Desktop core",
                    schemaDefaultEnabled: false,
                },
                {
                    schemaName: "desktop.click",
                    description: "Mouse click",
                    schemaDefaultEnabled: false,
                },
            ],
            descriptions: { desktop: "Desktop automation" },
        });
        const disabled = findDisabledAgents(ctx);
        expect(disabled).toHaveLength(1);
        expect(disabled[0].agentName).toBe("desktop");
        expect(disabled[0].disabledSchemas).toHaveLength(2);
    });
});

describe("findInstallableAgents", () => {
    it("returns an empty list when there are no sources", async () => {
        expect(await findInstallableAgents(fakeContext([]))).toEqual([]);
    });

    it("flattens installable agents across sources", async () => {
        const ctx = fakeContext([
            sourceReturning([summary("photo", "typeagent-feed", "Photos")]),
            sourceReturning([summary("montage", "catalog")]),
        ]);
        const names = (await findInstallableAgents(ctx)).map(
            (a) => a.installName,
        );
        expect(names.sort()).toEqual(["montage", "photo"]);
    });

    it("excludes agents that are already present as app agents", async () => {
        const ctx = fakeContext(
            [
                sourceReturning([
                    summary("photo", "typeagent-feed"),
                    summary("montage", "typeagent-feed"),
                ]),
            ],
            ["montage"], // already present in getAppAgentNames()
        );
        const names = (await findInstallableAgents(ctx)).map(
            (a) => a.installName,
        );
        expect(names).toEqual(["photo"]);
    });

    it("de-dupes the same install name across sources (first wins)", async () => {
        const ctx = fakeContext([
            sourceReturning([summary("photo", "feed-a", "from A")]),
            sourceReturning([summary("photo", "feed-b", "from B")]),
        ]);
        const result = await findInstallableAgents(ctx);
        expect(result).toHaveLength(1);
        expect(result[0].source).toBe("feed-a");
    });

    it("ignores a source whose discovery throws (best-effort)", async () => {
        const throwing: AppAgentSource = {
            connect: () => {
                throw new Error("connect not used");
            },
            listAvailableAgents: async () => {
                throw new Error("feed offline");
            },
        };
        const ctx = fakeContext([
            throwing,
            sourceReturning([summary("photo", "feed")]),
        ]);
        const names = (await findInstallableAgents(ctx)).map(
            (a) => a.installName,
        );
        expect(names).toEqual(["photo"]);
    });

    it("skips a source without a listAvailableAgents implementation", async () => {
        const noDiscovery: AppAgentSource = {
            connect: () => {
                throw new Error("connect not used");
            },
        };
        const ctx = fakeContext([
            noDiscovery,
            sourceReturning([summary("photo", "feed")]),
        ]);
        const names = (await findInstallableAgents(ctx)).map(
            (a) => a.installName,
        );
        expect(names).toEqual(["photo"]);
    });
});

describe("findAgentAvailabilityOptions & formatAgentAvailabilityOptions", () => {
    it("reports when nothing is disabled or installable", () => {
        expect(
            formatAgentAvailabilityOptions({ disabled: [], installable: [] }),
        ).toContain("No disabled or installable agents are available");
    });

    it("formats both disabled and installable sections", async () => {
        const ctx = fakeContext(
            [sourceReturning([summary("photo", "feed", "Organize photos")])],
            ["code"],
            {
                actionConfigs: [
                    {
                        schemaName: "code",
                        description: "Code assistant",
                        schemaDefaultEnabled: false,
                    },
                ],
                descriptions: { code: "Code assistant" },
            },
        );

        const options = await findAgentAvailabilityOptions(ctx);
        expect(options.disabled).toHaveLength(1);
        expect(options.installable).toHaveLength(1);

        const text = formatAgentAvailabilityOptions(options);
        expect(text).toContain("1 present agent(s) currently disabled:");
        expect(text).toContain("@config agent code");
        expect(text).toContain("capability (code): Code assistant");
        expect(text).toContain(
            "1 installable agent(s) not currently installed:",
        );
        expect(text).toContain("@package install photo");
        expect(text).toContain("Prefer suggesting an already-present agent");
    });

    it("uses a generic setup caveat without inventing a setup command", () => {
        const text = formatAgentAvailabilityOptions({
            disabled: [
                {
                    agentName: "calendar",
                    disabledSchemas: [{ schemaName: "calendar" }],
                    enableCommand: "@config agent calendar",
                    needsSetup: true,
                },
            ],
            installable: [],
        });
        expect(text).toContain(
            "Additional setup may be required after enabling.",
        );
        expect(text).not.toContain("@config agent setup");
    });

    it("sanitizes control characters in descriptions", () => {
        const text = formatAgentAvailabilityOptions({
            disabled: [],
            installable: [
                summary("test", "feed", "Hello\x00\x1bWorld\r\n\tDescription"),
            ],
        });
        expect(text).not.toContain("\x00");
        expect(text).not.toContain("\x1b");
        expect(text).toContain("Hello World Description");
    });

    it("formatInstallableAgents maintains backward-compatible formatting", () => {
        const text = formatInstallableAgents([
            summary("photo", "feed", "Organize photos"),
        ]);
        expect(text).toContain(
            "1 installable agent(s) not currently installed:",
        );
        expect(text).toContain("@package install photo");
    });

    it("builds install commands from the validated install name", () => {
        const agent = summary("photo", "feed", "Organize photos");
        const text = formatAgentAvailabilityOptions({
            disabled: [],
            installable: [
                {
                    ...agent,
                    installCommand: "@package install attacker",
                },
            ],
        });
        expect(text).toContain("@package install photo");
        expect(text).not.toContain("@package install attacker");
    });

    it("caps the combined availability result", () => {
        const installable = Array.from({ length: 40 }, (_, index) =>
            summary(
                `agent${index}`,
                "feed",
                `${index} ${"description ".repeat(100)}`,
            ),
        );
        const text = formatAgentAvailabilityOptions({
            disabled: [],
            installable,
        });
        expect(text.length).toBeLessThanOrEqual(12_000);
        expect(text).toContain("Additional candidates omitted");
    });
});
