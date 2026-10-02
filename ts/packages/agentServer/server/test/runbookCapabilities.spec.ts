// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { MacroManager, type CopilotToolMacro } from "@typeagent/copilot-macros";
import {
    createChannelProviderAdapter,
    type ChannelProviderAdapter,
} from "@typeagent/agent-rpc/channel";
import { createAgentRpcClient } from "@typeagent/agent-rpc/client";
import { createAgentRpcServer } from "@typeagent/agent-rpc/server";
import { createAgentServerConnection } from "@typeagent/agent-server-client";
import type { RunbookHostCapabilities } from "@typeagent/agent-server-protocol";
import type { RegisteredMcpToolCatalog } from "default-agent-provider";
import { createLocalSkillServices } from "../src/skillCatalog.js";
import {
    createRunbookHostCapabilities,
    withRunbookHostCapabilities,
} from "../src/runbookCapabilities.js";
import { createRunbookBindingCatalog } from "../src/runbookBindingCatalog.js";
import { createAgentServerConnectionHandler } from "../src/connectionHandler.js";
import type { ConversationManager } from "../src/conversationManager.js";
import { createRunbookBindingValidator } from "../src/runbookBindingValidator.js";
import { rankRunbookBindings } from "../src/runbookBindingSuggestions.js";

const identity = {
    scope: "user" as const,
    origin: "runbook-test",
    name: "recover",
};

async function readMcpCatalogs(): Promise<RegisteredMcpToolCatalog[]> {
    return [
        {
            serverConfigId: "server",
            name: "actual",
            trust: "trusted",
            enabled: true,
            available: true,
            entries: [
                {
                    id: '["server","recover"]',
                    serverConfigId: "server",
                    name: "recover",
                    fingerprint: "schema",
                    inputSchema: {
                        type: "object",
                        properties: { target: { type: "string" } },
                        required: ["target"],
                        additionalProperties: false,
                    },
                },
            ],
        },
    ];
}

function channels(name: string, serialized = true) {
    let client: ChannelProviderAdapter;
    const server = createChannelProviderAdapter(`${name}-server`, (message) => {
        queueMicrotask(() =>
            client.notifyMessage(
                serialized ? JSON.parse(JSON.stringify(message)) : message,
            ),
        );
    });
    client = createChannelProviderAdapter(`${name}-client`, (message) => {
        queueMicrotask(() =>
            server.notifyMessage(
                serialized ? JSON.parse(JSON.stringify(message)) : message,
            ),
        );
    });
    return { client, server };
}

describe("runbook host capabilities", () => {
    const root = path.join(process.cwd(), `.runbook-host-${randomUUID()}`);
    afterAll(() => rm(root, { recursive: true, force: true }));

    async function services(mcp = false) {
        const { skillCatalog } = await createLocalSkillServices(
            path.join(root, randomUUID()),
        );
        const macroManager = new MacroManager(root);
        const capabilities = createRunbookHostCapabilities({
            skillCatalog,
            macroManager,
            ...(mcp ? { readMcpCatalogs } : {}),
        });
        return { skillCatalog, macroManager, capabilities };
    }

    test("local carrier validates exact revisions, CAS conflicts, real allowed actions and missing artifacts", async () => {
        const { skillCatalog, capabilities } = await services();
        const first = await skillCatalog.publish({
            identity,
            schemaFingerprint: "schema",
            files: [{ path: "SKILL.md", content: "first" }],
        });
        const second = await skillCatalog.publish({
            identity,
            schemaFingerprint: "schema",
            files: [{ path: "SKILL.md", content: "second" }],
        });
        const ref = { identity, revision: first.revision.revision };
        expect(
            (await capabilities.getSkillLifecycle(ref)).allowedActions,
        ).toEqual(["changeState", "validate", "archive"]);
        const mutation = {
            ...ref,
            expectedState: "draft" as const,
            expectedActive: false,
            action: "validate" as const,
        };
        const outcomes = await Promise.allSettled([
            capabilities.changeSkillLifecycle(mutation),
            capabilities.changeSkillLifecycle(mutation),
        ]);
        expect(
            outcomes.filter((result) => result.status === "fulfilled"),
        ).toHaveLength(1);
        expect(
            outcomes.filter((result) => result.status === "rejected"),
        ).toHaveLength(1);
        expect(
            await skillCatalog.get(identity, second.revision.revision),
        ).toMatchObject({ state: "draft" });
        await capabilities.changeSkillLifecycle({
            ...ref,
            expectedState: "validated",
            expectedActive: false,
            action: "changeState",
            state: "approved",
        });
        await capabilities.changeSkillLifecycle({
            ...ref,
            expectedState: "approved",
            expectedActive: false,
            action: "activate",
        });
        await capabilities.changeSkillLifecycle({
            ...ref,
            expectedState: "active",
            expectedActive: true,
            action: "disable",
        });
        await capabilities.changeSkillLifecycle({
            ...ref,
            expectedState: "disabled",
            expectedActive: false,
            action: "rollback",
        });
        await capabilities.changeSkillLifecycle({
            ...ref,
            expectedState: "active",
            expectedActive: true,
            action: "archive",
        });
        expect(
            (await capabilities.getSkillLifecycle(ref)).allowedActions,
        ).toEqual([]);
        await expect(
            capabilities.promoteProcedureArtifact({
                kind: "skill",
                corpusId: "c",
                procedureId: "p",
                version: 1,
                skill: { identity },
            }),
        ).rejects.toThrow("unavailable");
        await expect(capabilities.listSkills({ limit: 201 })).rejects.toThrow(
            "pagination",
        );
    });

    test.each(["websocket-json", "in-process-loopback"])(
        "%s host handler delegates named catalog and lifecycle RPCs",
        async (transport) => {
            const { skillCatalog, macroManager, capabilities } =
                await services(true);
            const entry = await skillCatalog.publish({
                identity,
                schemaFingerprint: "schema",
                files: [{ path: "SKILL.md", content: "review" }],
            });
            const pair = channels(
                `runbook-${transport}`,
                transport === "websocket-json",
            );
            const { handler } = createAgentServerConnectionHandler({
                conversationManager: {} as ConversationManager,
                skillCatalog,
                macroManager,
                runbookCapabilities: capabilities,
                shutdown: () => {},
                getUserIdentity: () => ({
                    username: "test",
                    displayName: "Test",
                    initial: "T",
                }),
            });
            handler(pair.server, () => {});
            const connection = createAgentServerConnection(
                pair.client,
                () => {},
            );
            try {
                expect(
                    await connection.getSkillLifecycle!({
                        identity,
                        revision: entry.revision.revision,
                    }),
                ).toMatchObject({ entry: { state: "draft" } });
                const target = (await connection.listBindingTargets!())
                    .targets[0];
                expect(
                    (
                        await connection.checkBindingTargets!({
                            bindings: [target],
                        })
                    ).valid,
                ).toBe(false);
                expect(
                    (
                        await connection.checkBindingTargets!({
                            bindings: [
                                { ...target, arguments: { target: "service" } },
                            ],
                        })
                    ).valid,
                ).toBe(true);
                const template = { target: { $input: "service" } };
                expect(
                    (
                        await connection.checkBindingTargets!({
                            bindings: [{ ...target, arguments: template }],
                            inputs: [
                                {
                                    id: "service",
                                    description: "Service",
                                    type: "string",
                                    required: true,
                                    secret: false,
                                },
                            ],
                        })
                    ).valid,
                ).toBe(true);
                expect(
                    (
                        await connection.checkBindingTargets!({
                            bindings: [{ ...target, arguments: template }],
                        })
                    ).issues[0].code,
                ).toBe("unavailable");
                await connection.changeSkillLifecycle!({
                    identity,
                    revision: entry.revision.revision,
                    expectedState: "draft",
                    expectedActive: false,
                    action: "validate",
                });
                await expect(
                    connection.changeSkillLifecycle!({
                        identity,
                        revision: entry.revision.revision,
                        expectedState: "draft",
                        expectedActive: false,
                        action: "archive",
                    }),
                ).rejects.toThrow("conflict");
            } finally {
                pair.client.notifyDisconnected();
                pair.server.notifyDisconnected();
            }
        },
    );

    test("isolated agentRpc serializes the plain callable carrier without execution or approval", async () => {
        const { skillCatalog, capabilities } = await services(true);
        await skillCatalog.publish({
            identity,
            schemaFingerprint: "schema",
            files: [{ path: "SKILL.md", content: "review" }],
        });
        const pair = channels("runbook-isolated");
        let readCount = 0;
        let bindingValid = false;
        let argumentAttested = false;
        let echoedArguments: unknown;
        const rpcServer = createAgentRpcServer(
            "runbook",
            {
                initializeAgentContext: async (settings) => {
                    const options = settings?.options as {
                        runbookCapabilities: RunbookHostCapabilities;
                    };
                    readCount = (await options.runbookCapabilities.listSkills())
                        .length;
                    const target = (
                        await options.runbookCapabilities.listBindingTargets()
                    ).targets[0];
                    const checked =
                        await options.runbookCapabilities.checkBindingTargets({
                            bindings: [
                                {
                                    ...target,
                                    arguments: {
                                        target: { $input: "service" },
                                    },
                                },
                            ],
                            inputs: [
                                {
                                    id: "service",
                                    description: "Service",
                                    type: "string",
                                    required: true,
                                    secret: false,
                                },
                            ],
                        });
                    bindingValid = checked.valid;
                    argumentAttested =
                        checked.argumentChecks?.[0].argumentsValidated === true;
                    echoedArguments =
                        checked.argumentChecks?.[0].binding.arguments;
                    return {};
                },
            },
            pair.server,
        );
        const client = await createAgentRpcClient(
            "runbook",
            pair.client,
            rpcServer.agentInterface,
        );
        try {
            const options = withRunbookHostCapabilities(
                { browser: { memoryServiceClient: {} } },
                capabilities,
            );
            await client.initializeAgentContext!({ options: options.browser });
            expect(readCount).toBe(1);
            expect(bindingValid).toBe(true);
            expect(argumentAttested).toBe(true);
            expect(echoedArguments).toEqual({ target: { $input: "service" } });
            expect((await capabilities.listSkills())[0].state).toBe("draft");
        } finally {
            rpcServer.closeFn();
            pair.client.notifyDisconnected();
            pair.server.notifyDisconnected();
        }
    });

    test("real skill validation rejects malformed grammar without changing lifecycle state", async () => {
        const { skillCatalog, capabilities } = await services();
        const entry = await skillCatalog.publish({
            identity,
            schemaFingerprint: "schema",
            files: [
                { path: "SKILL.md", content: "review" },
                { path: "routing/main.ag.json", content: "{invalid" },
            ],
        });
        await expect(
            capabilities.changeSkillLifecycle({
                identity,
                revision: entry.revision.revision,
                expectedState: "draft",
                expectedActive: false,
                action: "validate",
            }),
        ).rejects.toThrow();
        expect(
            (
                await capabilities.getSkillLifecycle({
                    identity,
                    revision: entry.revision.revision,
                })
            ).entry.state,
        ).toBe("draft");
    });
});

function macro(
    state: CopilotToolMacro["state"],
    secret = false,
): CopilotToolMacro {
    return {
        schemaVersion: 1,
        macroId: `${state}-${secret}`,
        version: 2,
        name: "Recovery",
        description: "Recovery procedure",
        state,
        executionClass: "replayable",
        inputs: [
            {
                name: "target",
                description: "Target",
                required: true,
                secret,
                valueType: "string",
            },
        ],
        steps: [],
        sourceTraceId: "trace",
        createdAt: "2026-10-02",
        warnings: [],
    };
}

describe("real binding target snapshots", () => {
    test("reports unavailable catalogs and excludes secret-input MCP tools rather than granting permission", async () => {
        const catalog = createRunbookBindingCatalog(
            {
                getApprovedMacros: async () => [],
                listMacros: async () => [],
            },
            async () => [
                {
                    serverConfigId: "server",
                    name: "actual-server",
                    trust: "trusted",
                    enabled: true,
                    available: true,
                    notices: ["Unsupported MCP tool excluded: unsafe-schema."],
                    entries: [
                        {
                            id: '["server","secret"]',
                            serverConfigId: "server",
                            name: "secret",
                            fingerprint: "schema",
                            inputSchema: {
                                type: "object",
                                properties: { password: { type: "string" } },
                            },
                        },
                    ],
                },
            ],
        );
        const snapshot = await catalog.listBindingTargets();
        expect(snapshot.targets).toEqual([]);
        expect(snapshot.notices).toContain(
            "Unsupported MCP tool excluded: unsafe-schema.",
        );
        expect(
            snapshot.notices.some((notice) => notice.includes("secret-input")),
        ).toBe(true);
        const missing = await catalog.checkBindingTargets({
            bindings: [
                {
                    kind: "flow",
                    id: "visible-but-unapproved",
                    version: "1",
                    fingerprint: "fake",
                },
            ],
        });
        expect(missing.valid).toBe(false);
        const absent = createRunbookBindingCatalog(
            {
                getApprovedMacros: async () => [],
                listMacros: async () => [],
            },
            async () => {
                throw new Error("Catalog offline");
            },
        );
        expect((await absent.listBindingTargets()).notices).toContain(
            "Catalog offline",
        );
    });

    test("filters unapproved/secret macros and unsupported flows; detects current schema/version drift", async () => {
        const macros = [
            macro("approved"),
            macro("draft"),
            macro("approved", true),
        ];
        let fingerprint = "real-schema-1";
        const readMcp = async (): Promise<RegisteredMcpToolCatalog[]> => [
            {
                serverConfigId: "server",
                name: "actual-server",
                trust: "trusted",
                enabled: true,
                available: true,
                entries: [
                    {
                        id: '["server","recover"]',
                        serverConfigId: "server",
                        name: "recover",
                        inputSchema: { type: "object", properties: {} },
                        fingerprint,
                        annotations: {
                            readOnlyHint: true,
                            destructiveHint: false,
                        },
                    },
                ],
            },
        ];
        const catalog = createRunbookBindingCatalog(
            {
                getApprovedMacros: async () => macros,
                listMacros: async () =>
                    macros.map((item) => ({
                        macroId: item.macroId,
                        version: item.version,
                        name: item.name,
                        description: item.description,
                        state: item.state,
                        executionClass: item.executionClass,
                        stepCount: 0,
                        updatedAt: item.createdAt,
                    })),
            },
            readMcp,
        );
        const snapshot = await catalog.listBindingTargets();
        expect(snapshot.targets.map((item) => item.kind)).toEqual([
            "macro",
            "mcp",
        ]);
        expect(snapshot.notices).toHaveLength(3);
        const binding = snapshot.targets[1];
        expect(
            await catalog.checkBindingTargets({ bindings: [binding] }),
        ).toEqual({
            valid: true,
            issues: [],
            argumentChecks: [
                { binding, bindingIndex: 0, argumentsValidated: true },
            ],
        });
        fingerprint = "real-schema-2";
        expect(
            await catalog.checkBindingTargets({ bindings: [binding] }),
        ).toMatchObject({
            valid: false,
            issues: [{ message: expect.stringContaining("drifted") }],
        });
        macros[0].state = "disabled";
        expect(
            await catalog.checkBindingTargets({
                bindings: [snapshot.targets[0]],
            }),
        ).toMatchObject({ valid: false });
        const validate = createRunbookBindingValidator(catalog);
        expect(
            await validate([
                {
                    kind: "mcp",
                    accepted: true,
                    serverId: "different",
                    targetId: "recover",
                    version: binding.version,
                    fingerprint: binding.fingerprint,
                },
            ]),
        ).toMatchObject([{ status: "unavailable" }]);
        expect(
            await validate([
                {
                    kind: "mcp",
                    accepted: true,
                    serverId: "server",
                    targetId: "recover",
                    version: binding.version,
                    fingerprint: binding.fingerprint,
                },
            ]),
        ).toMatchObject([{ status: "drifted" }]);
    });

    test("ranks approved automation before MCP, command text and manual, without execution", () => {
        const schema = {
            type: "object",
            properties: { target: { type: "string" } },
            required: ["target"],
        };
        const common = {
            id: "id",
            name: "recover",
            version: "2",
            fingerprint: "fingerprint",
            inputSchema: schema,
            description: "Recovery",
            safety: { requiresConfirmation: true as const },
            permission: { status: "runtime-check-required" as const },
        };
        const result = rankRunbookBindings(
            { inputSchema: schema, commandText: "recover" },
            {
                targets: [
                    { ...common, kind: "mcp" },
                    { ...common, kind: "macro" },
                ],
                notices: [],
                total: 2,
            },
        );
        expect(result.suggestions.map((item) => item.kind)).toEqual([
            "macro",
            "mcp",
            "commandText",
            "manual",
        ]);
        expect(result.suggestions[0].reasons).toContain(
            "Explicit author and safety confirmation plus current catalog revalidation are required.",
        );
        expect(
            rankRunbookBindings(
                { inputSchema: { properties: {} } },
                {
                    targets: [{ ...common, kind: "mcp" }],
                    notices: [],
                    total: 1,
                },
            ).suggestions.map((item) => item.kind),
        ).toEqual(["manual"]);
    });
});
