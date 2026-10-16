// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createChannelProviderAdapter,
    type ChannelProviderAdapter,
} from "@typeagent/agent-rpc/channel";
import { createAgentRpcClient } from "@typeagent/agent-rpc/client";
import { createAgentRpcServer } from "@typeagent/agent-rpc/server";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import { createAgentServerConnection } from "@typeagent/agent-server-client";
import { AgentServerChannelName } from "@typeagent/agent-server-protocol";
import type { RunbookHostCapabilities } from "@typeagent/agent-server-protocol";
import type { RegisteredMcpToolCatalog } from "default-agent-provider";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { createAgentServerConnectionHandler } from "../src/connectionHandler.js";
import type { ConversationManager } from "../src/conversationManager.js";
import { createRunbookBindingCatalog } from "../src/runbookBindingCatalog.js";
import { rankRunbookBindings } from "../src/runbookBindingSuggestions.js";
import { createRunbookBindingValidator } from "../src/runbookBindingValidator.js";
import {
    createRunbookHostCapabilities,
    withRunbookHostCapabilities,
} from "../src/runbookCapabilities.js";
import { createLocalSkillServices } from "../src/skillCatalog.js";

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
        const capabilities = createRunbookHostCapabilities({
            skillCatalog,
            ...(mcp ? { readMcpCatalogs } : {}),
        });
        return { skillCatalog, capabilities };
    }

    test.each(["websocket-json", "in-process-loopback"])(
        "%s rejects retired macro RPCs instead of composing another owner",
        async (transport) => {
            const { skillCatalog } = await services();
            const pair = channels(
                `retired-macro-${transport}`,
                transport === "websocket-json",
            );
            const { handler } = createAgentServerConnectionHandler({
                conversationManager: {} as ConversationManager,
                skillCatalog,
                shutdown: () => {},
                getUserIdentity: () => ({
                    username: "test",
                    displayName: "Test",
                    initial: "T",
                }),
            });
            handler(pair.server, () => {});
            const rpc = createRpc<Record<string, () => Promise<unknown>>>(
                "retired-macro-client",
                pair.client.createChannel(AgentServerChannelName),
            );
            try {
                for (const method of [
                    "getMacroLearningPreference",
                    "setMacroLearningPreference",
                    "prepareMacroLearning",
                    "getMacroLearningJob",
                    "claimMacroAuthoringRequest",
                    "submitMacroAuthoringResponse",
                    "cancelMacroLearningJob",
                    "armMacroRecording",
                    "getMacroRecordingState",
                    "claimMacroRecording",
                    "cancelMacroRecording",
                    "failMacroRecording",
                    "finalizeMacroRecording",
                    "listMacros",
                    "searchMacros",
                    "inspectMacro",
                    "getMacroRequirements",
                    "validateMacro",
                    "approveMacro",
                    "disableMacro",
                    "deleteMacro",
                    "runMacro",
                    "cancelMacroRun",
                    "getMacroRun",
                ]) {
                    await expect(rpc.invoke(method)).rejects.toThrow();
                }
            } finally {
                pair.client.notifyDisconnected();
                pair.server.notifyDisconnected();
            }
        },
    );

    test.each(["websocket-json", "in-process-loopback"])(
        "%s host handler delegates named catalog and lifecycle RPCs",
        async (transport) => {
            const { skillCatalog, capabilities } = await services(true);
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

describe("real binding target snapshots", () => {
    test("reports unavailable catalogs and excludes secret-input MCP tools rather than granting permission", async () => {
        const catalog = createRunbookBindingCatalog(async () => [
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
        ]);
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
        const absent = createRunbookBindingCatalog(async () => {
            throw new Error("Catalog offline");
        });
        expect((await absent.listBindingTargets()).notices).toContain(
            "Catalog offline",
        );
    });

    test("excludes server macro bindings and detects current MCP schema/version drift", async () => {
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
        const catalog = createRunbookBindingCatalog(readMcp);
        const snapshot = await catalog.listBindingTargets();
        expect(snapshot.targets.map((item) => item.kind)).toEqual(["mcp"]);
        expect(snapshot.notices).toContain(
            "Macro bindings unavailable: checked programs are owned by the Copilot plugin, not this server.",
        );
        const binding = snapshot.targets[0];
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
        expect(
            await catalog.checkBindingTargets({
                bindings: [
                    {
                        kind: "macro",
                        id: "old-server-macro",
                        version: "1",
                        fingerprint: "old",
                    },
                ],
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
