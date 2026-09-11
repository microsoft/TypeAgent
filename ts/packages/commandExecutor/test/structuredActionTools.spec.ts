// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { jest } from "@jest/globals";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StructuredActionClientError } from "@typeagent/agent-server-client";
import { CommandServer } from "../src/commandServer.js";
import {
    registerStructuredActionTools,
    structuredToolResult,
    type StructuredActionClient,
} from "../src/structuredActionTools.js";

function createCaller(
    implementations: Partial<StructuredActionClient>,
): StructuredActionClient {
    const missing = (method: keyof StructuredActionClient) => async () => {
        throw new Error(`Unexpected ${method} call`);
    };
    return {
        binding: { conversationId: "conversation-1", connected: true },
        searchActions:
            implementations.searchActions ?? missing("searchActions"),
        getActionContract:
            implementations.getActionContract ?? missing("getActionContract"),
        executeAction:
            implementations.executeAction ?? missing("executeAction"),
        continueAction:
            implementations.continueAction ?? missing("continueAction"),
        cancelAction: implementations.cancelAction ?? missing("cancelAction"),
        close: implementations.close ?? (async () => {}),
    };
}

async function createHarness(caller: StructuredActionClient) {
    const server = new McpServer({
        name: "structured-action-test",
        version: "1.0.0",
    });
    registerStructuredActionTools(server, caller);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
    await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
    ]);
    return {
        client,
        async close() {
            await client.close();
            await server.close();
        },
    };
}

function asToolResult(result: Awaited<ReturnType<Client["callTool"]>>) {
    return result as CallToolResult;
}

function foundContract(
    schemaName: string,
    actionName: string,
    scopeId = "scope-1",
) {
    return {
        protocolVersion: 1 as const,
        scopeId,
        status: "found" as const,
        contract: {
            schemaName,
            actionName,
            description: `Contract for ${schemaName}.${actionName}`,
            availability: {
                state: "available" as const,
                schemaEnabled: true,
                actionEnabled: true,
                schemaActive: true,
                actionActive: true,
                readiness: { source: "not-checked" as const },
                authorization: "checked-at-execution" as const,
            },
            fingerprint: `${actionName}-fingerprint`,
            input: {
                format: "typescript" as const,
                typeName: `${actionName}Action`,
                schemaText: `type ${actionName}Action = {};`,
            },
            policy: {
                effects: "read-only" as const,
                confirmation: "not-required" as const,
            },
            output: {
                envelope: "ActionResult" as const,
                optional: true as const,
                resultValue: {
                    type: "unknown" as const,
                    optional: true as const,
                },
                resultEntity: {
                    type: "Entity" as const,
                    optional: true as const,
                },
                entities: {
                    type: "Entity[]" as const,
                    optional: true as const,
                },
            },
            interactions: {
                mode: "may-require-interaction" as const,
                kinds: [],
            },
        },
    };
}

describe("structured action MCP tools", () => {
    test.each([
        ["completed", false],
        ["requires_interaction", false],
        ["found", false],
        ["failed", true],
        ["cancelled", true],
        ["contract_stale", true],
        ["unavailable", true],
        ["execution_uncertain", true],
        ["not-found", true],
    ])("maps service status %s to isError=%s", (status, expectedError) => {
        const result = structuredToolResult({ status });
        expect(result.isError === true).toBe(expectedError);
        expect(result.structuredContent).toEqual({ status });
    });

    test("CommandServer routes get_user_context through contract and structured execution", async () => {
        const getActionContract = jest.fn(async () =>
            foundContract("code", "getActiveEditor", "scope-context"),
        );
        const executionResult = {
            protocolVersion: 1 as const,
            scopeId: "scope-context",
            operationId: "context-operation",
            status: "completed" as const,
            output: ["Active editor: commandServer.ts"],
            results: [],
        };
        const executeAction = jest.fn(async () => executionResult);
        const structuredClient = createCaller({
            getActionContract,
            executeAction,
        });
        const commandServer = new CommandServer(
            "ws://unused.invalid",
            structuredClient,
        );
        const client = new Client({ name: "test-client", version: "1.0.0" });
        const [clientTransport, serverTransport] =
            InMemoryTransport.createLinkedPair();
        await Promise.all([
            commandServer.server.connect(serverTransport),
            client.connect(clientTransport),
        ]);
        try {
            const tools = await client.listTools();
            expect(tools.tools.map((tool) => tool.name)).toEqual(
                expect.arrayContaining([
                    "discover_agents",
                    "get_action_contract",
                    "execute_action",
                    "continue_action",
                    "cancel_action",
                ]),
            );
            expect(
                tools.tools.find(
                    (tool) => tool.name === "run_workspace_command",
                )?.outputSchema,
            ).toMatchObject({ type: "object" });
            const binding = asToolResult(
                await client.callTool({
                    name: "connection_status",
                    arguments: {},
                }),
            );
            expect(binding.structuredContent).toMatchObject({
                structuredActions: structuredClient.binding,
            });
            const result = asToolResult(
                await client.callTool({
                    name: "get_user_context",
                    arguments: {},
                }),
            );
            expect(getActionContract).toHaveBeenCalledWith(
                {
                    schemaName: "code",
                    actionName: "getActiveEditor",
                },
                expect.anything(),
            );
            expect(executeAction).toHaveBeenCalledWith(
                {
                    protocolVersion: 1,
                    scopeId: "scope-context",
                    schemaName: "code",
                    actionName: "getActiveEditor",
                    fingerprint: "getActiveEditor-fingerprint",
                    parameters: {},
                },
                expect.anything(),
            );
            expect(result.structuredContent).toEqual(executionResult);
        } finally {
            await client.close();
            await commandServer.server.close();
            await commandServer.close();
        }
    });

    test("run_workspace_command adds completed payload without dropping the service envelope", async () => {
        const workspaceResult = {
            success: true,
            exitCode: 0,
            durationMs: 125,
            command: "pnpm test",
            cwd: "C:\\repo",
            stdout: {
                text: "PASS",
                truncated: false,
                totalBytes: 4,
            },
            stderr: {
                text: "",
                truncated: false,
                totalBytes: 0,
            },
            timedOut: false,
            cancelled: false,
            executionId: "workspace-1",
        };
        const executionResult = {
            protocolVersion: 1 as const,
            scopeId: "scope-workspace",
            operationId: "workspace-operation",
            status: "completed" as const,
            output: ["PASS"],
            results: [
                {
                    action: {
                        schemaName: "code.code-workbench",
                        actionName: "runWorkspaceCommand",
                        parameters: {
                            command: "pnpm test",
                            executionId: "workspace-1",
                        },
                    },
                    result: {
                        entities: [],
                        resultValue: workspaceResult,
                    },
                },
            ],
        };
        const executeAction = jest.fn(async () => executionResult);
        const commandServer = new CommandServer(
            "ws://unused.invalid",
            createCaller({
                getActionContract: async () =>
                    foundContract(
                        "code.code-workbench",
                        "runWorkspaceCommand",
                        "scope-workspace",
                    ),
                executeAction,
            }),
        );
        const client = new Client({ name: "test-client", version: "1.0.0" });
        const [clientTransport, serverTransport] =
            InMemoryTransport.createLinkedPair();
        await Promise.all([
            commandServer.server.connect(serverTransport),
            client.connect(clientTransport),
        ]);
        try {
            const result = asToolResult(
                await client.callTool({
                    name: "run_workspace_command",
                    arguments: {
                        command: "pnpm test",
                        executionId: "workspace-1",
                    },
                }),
            );
            expect(executeAction).toHaveBeenCalledWith(
                {
                    protocolVersion: 1,
                    scopeId: "scope-workspace",
                    schemaName: "code.code-workbench",
                    actionName: "runWorkspaceCommand",
                    fingerprint: "runWorkspaceCommand-fingerprint",
                    parameters: {
                        command: "pnpm test",
                        executionId: "workspace-1",
                    },
                },
                expect.anything(),
            );
            expect(result.structuredContent).toEqual({
                ...executionResult,
                ...workspaceResult,
            });
            expect(result.isError).toBeUndefined();
        } finally {
            await client.close();
            await commandServer.server.close();
            await commandServer.close();
        }
    });

    test("run_workspace_command returns an authoritative confirmation prompt unchanged", async () => {
        const pendingResult = {
            protocolVersion: 1 as const,
            scopeId: "scope-workspace",
            operationId: "workspace-operation",
            status: "requires_interaction" as const,
            interactionId: "workspace-confirmation",
            expiresAt: 42,
            output: [],
            results: [],
            prompt: {
                type: "confirmation" as const,
                action: {
                    protocolVersion: 1 as const,
                    scopeId: "scope-workspace",
                    schemaName: "code.code-workbench",
                    actionName: "runWorkspaceCommand",
                    fingerprint: "runWorkspaceCommand-fingerprint",
                    parameters: {
                        command: "pnpm test",
                        executionId: "workspace-2",
                    },
                },
                contract: foundContract(
                    "code.code-workbench",
                    "runWorkspaceCommand",
                    "scope-workspace",
                ).contract,
            },
        };
        const continueAction =
            jest.fn<StructuredActionClient["continueAction"]>();
        const commandServer = new CommandServer(
            "ws://unused.invalid",
            createCaller({
                getActionContract: async () =>
                    foundContract(
                        "code.code-workbench",
                        "runWorkspaceCommand",
                        "scope-workspace",
                    ),
                executeAction: async () => pendingResult,
                continueAction,
            }),
        );
        const client = new Client({ name: "test-client", version: "1.0.0" });
        const [clientTransport, serverTransport] =
            InMemoryTransport.createLinkedPair();
        await Promise.all([
            commandServer.server.connect(serverTransport),
            client.connect(clientTransport),
        ]);
        try {
            const result = asToolResult(
                await client.callTool({
                    name: "run_workspace_command",
                    arguments: {
                        command: "pnpm test",
                        executionId: "workspace-2",
                    },
                }),
            );
            expect(result.structuredContent).toEqual(pendingResult);
            expect(result.structuredContent).not.toHaveProperty("success");
            expect(result.isError).toBeUndefined();
            expect(continueAction).not.toHaveBeenCalled();
        } finally {
            await client.close();
            await commandServer.server.close();
            await commandServer.close();
        }
    });

    test("registers the native structured action tool names", async () => {
        const harness = await createHarness(createCaller({}));
        try {
            const tools = await harness.client.listTools();
            expect(tools.tools.map((tool) => tool.name)).toEqual([
                "discover_agents",
                "get_action_contract",
                "execute_action",
                "continue_action",
                "cancel_action",
            ]);
        } finally {
            await harness.close();
        }
    });

    test("preserves search, contract, and pending execution results", async () => {
        const searchResult = {
            protocolVersion: 1 as const,
            scopeId: "scope-1",
            actions: [],
            total: 0,
        };
        const contractResult = {
            protocolVersion: 1 as const,
            scopeId: "scope-1",
            status: "not-found" as const,
        };
        const pendingResult = {
            protocolVersion: 1 as const,
            scopeId: "scope-1",
            operationId: "operation-1",
            status: "requires_interaction" as const,
            interactionId: "interaction-1",
            expiresAt: 42,
            output: ["Review every field"],
            results: [
                {
                    action: {
                        schemaName: "email",
                        actionName: "send",
                        parameters: { recipients: ["person@example.com"] },
                    },
                    result: {
                        error: "Confirmation is still pending.",
                        errorCode: "confirmation_required",
                    },
                },
            ],
            prompt: {
                type: "form" as const,
                message: "Confirm the message",
                fields: [
                    {
                        id: "recipient",
                        kind: "pick" as const,
                        prompt: "Recipient",
                        choices: ["person@example.com"],
                        allowFreeText: true,
                    },
                ],
            },
        };
        const executeAction = jest.fn(async () => pendingResult);
        const continueAction =
            jest.fn<StructuredActionClient["continueAction"]>();
        const harness = await createHarness(
            createCaller({
                searchActions: async () => searchResult,
                getActionContract: async () => contractResult,
                executeAction,
                continueAction,
            }),
        );
        try {
            const search = asToolResult(
                await harness.client.callTool({
                    name: "discover_agents",
                    arguments: { query: "send email" },
                }),
            );
            expect(search.structuredContent).toEqual(searchResult);
            expect(search.isError).toBeUndefined();

            const contract = asToolResult(
                await harness.client.callTool({
                    name: "get_action_contract",
                    arguments: {
                        schemaName: "email",
                        actionName: "send",
                    },
                }),
            );
            expect(contract.structuredContent).toEqual(contractResult);
            expect(contract.isError).toBe(true);

            const request = {
                protocolVersion: 1,
                scopeId: "scope-1",
                schemaName: "email",
                actionName: "send",
                fingerprint: "fingerprint-1",
                parameters: {
                    recipients: ["person@example.com"],
                    metadata: {
                        $result: "previous",
                        opaque: [null, true, 7],
                    },
                },
            };
            const pending = asToolResult(
                await harness.client.callTool({
                    name: "execute_action",
                    arguments: request,
                }),
            );
            expect(executeAction).toHaveBeenCalledWith(
                request,
                expect.anything(),
            );
            expect(pending.structuredContent).toEqual(pendingResult);
            expect(pending.isError).toBeUndefined();
            expect(pending.content).toEqual([
                {
                    type: "text",
                    text: JSON.stringify(pendingResult, null, 2),
                },
            ]);
            expect(continueAction).not.toHaveBeenCalled();
        } finally {
            await harness.close();
        }
    });

    test("passes the exact form response including cancellation", async () => {
        const cancelledResult = {
            protocolVersion: 1 as const,
            scopeId: "scope-1",
            operationId: "operation-1",
            status: "cancelled" as const,
            output: [],
            results: [],
            error: {
                code: "cancelled" as const,
                message: "The user dismissed the form.",
            },
        };
        const continueAction = jest.fn(async () => cancelledResult);
        const harness = await createHarness(createCaller({ continueAction }));
        const request = {
            protocolVersion: 1,
            scopeId: "scope-1",
            operationId: "operation-1",
            interactionId: "interaction-1",
            response: {
                type: "form",
                value: {
                    answers: {
                        destination: {
                            kind: "pick",
                            selected: -1,
                            text: "Literal user entry",
                        },
                        flags: {
                            kind: "multiChoice",
                            selected: [2, 0],
                            text: "Other",
                        },
                    },
                    cancelled: true,
                },
            },
        };
        try {
            const result = asToolResult(
                await harness.client.callTool({
                    name: "continue_action",
                    arguments: request,
                }),
            );
            expect(continueAction).toHaveBeenCalledWith(
                request,
                expect.anything(),
            );
            expect(result.structuredContent).toEqual(cancelledResult);
            expect(result.isError).toBe(true);
        } finally {
            await harness.close();
        }
    });

    test("rejects the unsupported text form-answer variant", async () => {
        const continueAction =
            jest.fn<StructuredActionClient["continueAction"]>();
        const harness = await createHarness(createCaller({ continueAction }));
        try {
            const result = asToolResult(
                await harness.client.callTool({
                    name: "continue_action",
                    arguments: {
                        protocolVersion: 1,
                        scopeId: "scope-1",
                        operationId: "operation-1",
                        interactionId: "interaction-1",
                        response: {
                            type: "form",
                            value: {
                                answers: {
                                    unsupported: {
                                        kind: "text",
                                        value: "not in QuestionFormResponse",
                                    },
                                },
                            },
                        },
                    },
                }),
            );
            expect(result.isError).toBe(true);
            expect(continueAction).not.toHaveBeenCalled();
        } finally {
            await harness.close();
        }
    });

    test("does not dispatch an incomplete generic action request", async () => {
        const executeAction =
            jest.fn<StructuredActionClient["executeAction"]>();
        const harness = await createHarness(createCaller({ executeAction }));
        try {
            const result = asToolResult(
                await harness.client.callTool({
                    name: "execute_action",
                    arguments: {
                        schemaName: "code.code-workbench",
                        actionName: "runWorkspaceCommand",
                        parameters: { command: "pnpm test" },
                    },
                }),
            );
            expect(result.isError).toBe(true);
            expect(executeAction).not.toHaveBeenCalled();
        } finally {
            await harness.close();
        }
    });

    test("preserves a safe explicit resume rejection without exposing capabilities", async () => {
        const harness = await createHarness(
            createCaller({
                searchActions: async () => {
                    throw new StructuredActionClientError(
                        false,
                        "resume_rejected",
                    );
                },
            }),
        );
        try {
            const result = asToolResult(
                await harness.client.callTool({
                    name: "discover_agents",
                    arguments: {},
                }),
            );
            expect(result.isError).toBe(true);
            expect(result.structuredContent).toMatchObject({
                status: "unavailable",
                error: { code: "resume_rejected" },
                source: "command-executor-transport",
            });
        } finally {
            await harness.close();
        }
    });

    test("reports transport uncertainty without faking success", async () => {
        const harness = await createHarness(
            createCaller({
                executeAction: async () => {
                    throw new Error("secret transport details");
                },
            }),
        );
        try {
            const result = asToolResult(
                await harness.client.callTool({
                    name: "execute_action",
                    arguments: {
                        protocolVersion: 1,
                        scopeId: "scope-1",
                        schemaName: "list",
                        actionName: "addItems",
                        fingerprint: "fingerprint-1",
                        parameters: { items: ["milk"] },
                    },
                }),
            );
            expect(result.isError).toBe(true);
            expect(result.structuredContent).toMatchObject({
                status: "execution_uncertain",
                error: { code: "transport_error" },
            });
            expect(JSON.stringify(result)).not.toContain(
                "secret transport details",
            );
        } finally {
            await harness.close();
        }
    });
});
