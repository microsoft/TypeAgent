// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
    StructuredActionClient,
    StructuredActionClientError,
} from "@typeagent/agent-server-client";
import type {
    JsonValue,
    RecipeBindingScope,
    RecipeCallContext,
    RecipeHost,
} from "@typeagent/copilot-macros/recipeCore";
import type {
    ActionContract,
    StructuredActionExecutionResult,
} from "@typeagent/dispatcher-types";
import { registerStructuredActionTools } from "../src/mcp/structuredActionTools.js";
import {
    RecipeTypeAgentAdapter,
    createTypeAgentRecipeDependency,
    recipeTypeAgentTools,
    type RecipeTypeAgentTools,
} from "../src/shared/recipe-typeagent.js";

const contract: ActionContract = {
    schemaName: "fixture",
    actionName: "read",
    description: "Offline synthetic fixture, not a live backend.",
    input: {
        format: "typescript",
        typeName: "Read",
        schemaText:
            'type Read = { actionName: "read"; parameters: { text: string } };',
    },
    policy: { effects: "read-only", confirmation: "not-required" },
    output: {
        envelope: "ActionResult",
        optional: true,
        resultValue: { type: "unknown", optional: true },
        resultEntity: { type: "Entity", optional: true },
        entities: { type: "Entity[]", optional: true },
    },
    interactions: {
        mode: "may-require-interaction",
        kinds: ["question", "choice", "form", "action-proposal"],
    },
};
const tools = Object.fromEntries(
    Object.entries(recipeTypeAgentTools).map(([key, operation]) => [
        key,
        {
            id: `fixture:${operation}`,
            providerId: "fixture-mcp",
            transport: "mcp",
            operation,
            contractVersion: "1",
            inputSchema: {
                type: "object",
                properties: {},
                additionalProperties: false,
            },
            schemaDigest: `fixture:${operation}:1`,
            compatibility: "exact",
            effect: key === "search" ? "read" : "unknown",
        },
    ]),
) as RecipeTypeAgentTools;
const binding: RecipeBindingScope = {
    workspaceId: "fixture-workspace",
    profileId: "fixture-profile",
    providerId: "fixture-mcp",
    accountId: "fixture-account",
    sessionId: "fixture-session",
    generation: "1",
};
const dependency = createTypeAgentRecipeDependency(contract);
function completed(): StructuredActionExecutionResult {
    return {
        protocolVersion: 1,
        scopeId: "current-scope",
        operationId: "fixture-operation",
        status: "completed",
        output: ['raw "α" \\ value'],
        results: [
            {
                action: {
                    schemaName: "fixture",
                    actionName: "read",
                    parameters: { text: "007" },
                },
                result: {
                    entities: [],
                    resultValue: { nested: [null, false, "007", { id: "α" }] },
                },
            },
        ],
    };
}
function pending(): Extract<
    StructuredActionExecutionResult,
    { status: "requires_interaction" }
> {
    return {
        ...completed(),
        status: "requires_interaction",
        interactionId: "fixture-private-interaction",
        expiresAt: Date.now() + 60_000,
        prompt: {
            type: "question",
            message: "Ask the actual USER",
            choices: ["α", "no"],
            defaultId: 0,
        },
    };
}

describe("fixture-only TypeAgent recipe adapter over existing offline MCP tools", () => {
    let server: McpServer;
    let client: Client;
    let host: RecipeHost;
    let adapter: RecipeTypeAgentAdapter;
    let calls: { operation: string; input: JsonValue }[];
    let actions: ActionContract[];
    let scopeId: string;
    let reply: StructuredActionExecutionResult;
    let available: boolean;
    let throwAfterDispatch: boolean;
    let backendError: StructuredActionClientError | undefined;
    let rawReply: JsonValue | undefined;
    let counter: number;

    function context(
        overrides: Partial<RecipeCallContext> = {},
    ): RecipeCallContext {
        return {
            runId: "fixture-run",
            callId: `fixture-call-${++counter}`,
            binding,
            signal: new AbortController().signal,
            ...overrides,
        };
    }

    beforeEach(async () => {
        calls = [];
        actions = [structuredClone(contract)];
        scopeId = "current-scope";
        reply = completed();
        available = true;
        throwAfterDispatch = false;
        backendError = undefined;
        rawReply = undefined;
        counter = 0;
        const operation = async () => {
            if (backendError) throw backendError;
            return reply;
        };
        // This fake only implements the existing client's four protocol methods.
        // No Dispatcher, model, network connection, or action handler is created.
        const structured = {
            binding: { conversationId: "fixture-public-conversation" },
            searchActions: async () => ({
                protocolVersion: 1,
                scopeId,
                actions,
            }),
            executeAction: operation,
            continueAction: operation,
            cancelAction: operation,
        } as unknown as StructuredActionClient;
        server = new McpServer({ name: "fixture", version: "1" });
        registerStructuredActionTools(server, structured, () => "mcp");
        client = new Client({ name: "fixture-only-recipe", version: "1" });
        const [a, b] = InMemoryTransport.createLinkedPair();
        await server.connect(b);
        await client.connect(a);
        host = {
            inspectCapability: async (capability) =>
                available
                    ? { status: "available", capability }
                    : { status: "unavailable", message: "Fixture absent" },
            invokeCapability: async (capability, input) => {
                calls.push({ operation: capability.operation, input });
                if (
                    throwAfterDispatch &&
                    capability.operation !== tools.search.operation
                ) {
                    throw new Error("Fixture lost reply, not a live effect");
                }
                const result =
                    rawReply ??
                    (await client.callTool({
                        name: capability.operation,
                        arguments: input as Record<string, unknown>,
                    }));
                return {
                    status: "completed",
                    value: JSON.parse(JSON.stringify(result)) as JsonValue,
                };
            },
            invokeSemantic: async () => ({
                status: "unsupported",
                message: "Not installed in this fixture",
            }),
        };
        adapter = new RecipeTypeAgentAdapter({ host, tools });
    });
    afterEach(async () => {
        adapter.dispose();
        await client.close();
        await server.close();
    });
    const execute = () =>
        adapter.execute(dependency, { text: '  α "007" \\ \n' }, context());

    it("exports only the four existing protocol operations", async () => {
        expect(
            (await client.listTools()).tools.map((tool) => tool.name),
        ).toEqual(Object.values(recipeTypeAgentTools));
        expect(
            () =>
                new RecipeTypeAgentAdapter({
                    host,
                    tools: {
                        ...tools,
                        execute: {
                            ...tools.execute,
                            operation: "new-executor",
                        },
                    },
                }),
        ).toThrow("four existing");
    });

    it("discovers stable dependencies without scope/account/interaction constants", async () => {
        const found = await adapter.discover("read", context());
        expect(found.status).toBe("available");
        if (found.status !== "available") throw new Error("fixture");
        expect(found.actions[0].dependency).toEqual(dependency);
        const persisted = JSON.stringify(found.actions[0].dependency);
        for (const forbidden of [
            "scopeId",
            "accountId",
            "sessionId",
            "operationId",
            "interactionId",
            "conversationId",
        ]) {
            expect(persisted).not.toContain(forbidden);
        }
    });

    it("refreshes current scope each execution and preserves nested structured output", async () => {
        expect((await execute()).status).toBe("completed");
        scopeId = "scope-after-restart";
        reply = { ...completed(), scopeId };
        const result = await execute();
        expect(result.status).toBe("completed");
        expect(calls.map((call) => call.operation)).toEqual([
            tools.search.operation,
            tools.execute.operation,
            tools.search.operation,
            tools.execute.operation,
        ]);
        expect(calls[3].input).toEqual({
            protocolVersion: 1,
            scopeId: "scope-after-restart",
            schemaName: "fixture",
            actionName: "read",
            parameters: { text: '  α "007" \\ \n' },
        });
        expect(result.mcpResult).toMatchObject({
            structuredContent: { ...completed(), scopeId },
        });
        if (result.status === "completed") {
            expect(result.value).toEqual(result.mcpResult);
        }
    });

    it.each([
        "completed",
        "requires_interaction",
        "failed",
        "cancelled",
        "unavailable",
        "execution_uncertain",
    ] as const)("preserves %s independently of MCP isError", async (status) => {
        reply =
            status === "requires_interaction"
                ? pending()
                : status === "completed"
                  ? completed()
                  : {
                        ...completed(),
                        status,
                        error: {
                            code: "execution_failed",
                            message: "Fixture authoritative outcome",
                        },
                    };
        const outcome = await execute();
        expect(outcome.status).toBe(status);
        expect(outcome.mcpResult).toMatchObject({
            structuredContent: { status },
            ...(status === "completed" || status === "requires_interaction"
                ? {}
                : { isError: true }),
        });
    });

    it("does not autoanswer a default and forwards only an explicit user continuation", async () => {
        reply = pending();
        const outcome = await execute();
        if (outcome.status !== "requires_interaction")
            throw new Error("fixture");
        expect(JSON.parse(outcome.prompt)).toEqual(pending().prompt);
        expect(calls).toHaveLength(2);
        reply = completed();
        expect(
            (
                await adapter.continueAction(
                    outcome.interactionId,
                    {
                        source: "user",
                        response: { type: "question", selected: 1 },
                    },
                    context(),
                )
            ).status,
        ).toBe("completed");
        expect(calls[2]).toEqual({
            operation: tools.continue.operation,
            input: {
                protocolVersion: 1,
                scopeId: "current-scope",
                operationId: "fixture-operation",
                interactionId: "fixture-private-interaction",
                response: { type: "question", selected: 1 },
            },
        });
        expect(
            (
                await adapter.continueAction(
                    outcome.interactionId,
                    {
                        source: "user",
                        response: { type: "question", selected: 1 },
                    },
                    context(),
                )
            ).status,
        ).toBe("denied");
        expect(calls).toHaveLength(3);
    });

    it("forwards actual user cancellation without claiming rollback", async () => {
        reply = pending();
        const outcome = await execute();
        if (outcome.status !== "requires_interaction")
            throw new Error("fixture");
        reply = {
            ...completed(),
            status: "cancelled",
            error: { code: "cancelled", message: "No rollback guarantee" },
        };
        const cancelled = await adapter.cancelAction(
            outcome.interactionId,
            { source: "user" },
            context(),
        );
        expect(cancelled.status).toBe("cancelled");
        expect(calls[2].operation).toBe(tools.cancel.operation);
        expect(calls[2].input).not.toHaveProperty("response");
    });

    it("preserves the complete form and concrete actual user answers", async () => {
        reply = {
            ...pending(),
            status: "requires_interaction",
            interactionId: "fixture-form",
            expiresAt: Date.now() + 60_000,
            prompt: {
                type: "form",
                message: "Answer every field",
                paged: true,
                fields: [
                    {
                        id: "α",
                        kind: "pick",
                        prompt: "Choose or write",
                        choices: ["a", "b"],
                        allowFreeText: true,
                    },
                    {
                        id: "consent",
                        kind: "yesNo",
                        prompt: "Confirm?",
                        defaultValue: true,
                    },
                ],
            },
        };
        const outcome = await execute();
        if (outcome.status !== "requires_interaction")
            throw new Error("fixture");
        expect(JSON.parse(outcome.prompt)).toEqual(reply.prompt);
        const response = {
            type: "form" as const,
            value: {
                answers: {
                    α: { kind: "pick" as const, selected: -1, text: '007 "α"' },
                    consent: { kind: "yesNo" as const, value: false },
                },
            },
        };
        reply = completed();
        expect(
            (
                await adapter.continueAction(
                    outcome.interactionId,
                    { source: "user", response },
                    context(),
                )
            ).status,
        ).toBe("completed");
        expect(calls[2].input).toHaveProperty("response", response);
    });

    it.each(["accountId", "sessionId", "generation", "workspaceId"] as const)(
        "rejects an interaction after %s changes",
        async (field) => {
            reply = pending();
            const outcome = await execute();
            if (outcome.status !== "requires_interaction")
                throw new Error("fixture");
            expect(
                (
                    await adapter.cancelAction(
                        outcome.interactionId,
                        { source: "user" },
                        context({
                            binding: { ...binding, [field]: "changed" },
                        }),
                    )
                ).status,
            ).toBe("denied");
            expect(calls).toHaveLength(2);
        },
    );

    it("rejects expiry, fabricated user responses, and foreign runs without dispatch", async () => {
        reply = {
            ...pending(),
            expiresAt: Date.now() - 1,
        } as StructuredActionExecutionResult;
        const outcome = await execute();
        if (outcome.status !== "requires_interaction")
            throw new Error("fixture");
        expect(
            (
                await adapter.continueAction(
                    outcome.interactionId,
                    {
                        source: "user",
                        response: { type: "question", selected: 0 },
                    },
                    context({ runId: "foreign-run" }),
                )
            ).status,
        ).toBe("denied");
        expect(
            (
                await adapter.continueAction(
                    outcome.interactionId,
                    { source: "model" } as unknown as {
                        source: "user";
                        response: { type: "question"; selected: number };
                    },
                    context(),
                )
            ).status,
        ).toBe("denied");
        expect(
            (
                await adapter.continueAction(
                    outcome.interactionId,
                    {
                        source: "user",
                        response: { type: "question", selected: 0 },
                    },
                    context(),
                )
            ).status,
        ).toBe("unavailable");
        expect(calls).toHaveLength(2);
    });

    it("preflights all dependencies before effects and rejects changed contracts", async () => {
        expect((await adapter.preflight([dependency], context())).status).toBe(
            "completed",
        );
        actions[0].input.schemaText += " // changed";
        expect((await adapter.preflight([dependency], context())).status).toBe(
            "unavailable",
        );
        expect((await execute()).status).toBe("unavailable");
        expect(
            calls.every((call) => call.operation === tools.search.operation),
        ).toBe(true);
    });

    it("binds equivalent contract property order to the same stable dependency", () => {
        expect(
            createTypeAgentRecipeDependency({
                ...contract,
                policy: {
                    confirmation: contract.policy.confirmation,
                    effects: contract.policy.effects,
                },
            }),
        ).toEqual(dependency);
    });

    it("rejects malformed discovery rather than asserting untrusted contracts", async () => {
        actions = [
            {
                ...contract,
                policy: { effects: "invented" },
            } as unknown as ActionContract,
        ];
        expect((await adapter.discover("read", context())).status).toBe(
            "unavailable",
        );
        expect((await execute()).status).toBe("unavailable");
        expect(
            calls.every((call) => call.operation === tools.search.operation),
        ).toBe(true);
    });

    it("does not mistake missing isError for structured success", async () => {
        const original = host.invokeCapability;
        host.invokeCapability = async (capability, input, ctx) =>
            capability.operation === tools.search.operation
                ? original(capability, input, ctx)
                : {
                      status: "completed",
                      value: {
                          structuredContent: {
                              ...completed(),
                              status: "failed",
                              error: {
                                  code: "execution_failed",
                                  message: "failed",
                              },
                          } as unknown as JsonValue,
                          isError: false,
                      },
                  };
        const result = await execute();
        expect(result.status).toBe("failed");
        expect(result.mcpResult).toHaveProperty("isError", false);
    });

    it("does not autoapprove a confirmation with the MCP error bit set", async () => {
        const original = host.invokeCapability;
        host.invokeCapability = async (capability, input, ctx) =>
            capability.operation === tools.search.operation
                ? original(capability, input, ctx)
                : {
                      status: "completed",
                      value: {
                          structuredContent: {
                              ...pending(),
                              prompt: {
                                  type: "confirmation",
                                  contract,
                                  action: input,
                              },
                          } as unknown as JsonValue,
                          isError: true,
                      },
                  };
        const result = await execute();
        expect(result.status).toBe("requires_interaction");
        expect(result.mcpResult).toHaveProperty("isError", true);
        expect(calls).toHaveLength(1);
    });

    it("rejects oversized parameters before effectful host invocation", async () => {
        const result = await adapter.execute(
            dependency,
            { text: "x".repeat(1_048_577) },
            context(),
        );
        expect(result.status).toBe("unavailable");
        expect(calls).toHaveLength(1);
        expect(calls[0].operation).toBe(tools.search.operation);
    });

    it("honors caller cancellation before discovery or dispatch", async () => {
        const controller = new AbortController();
        controller.abort();
        expect(
            (
                await adapter.execute(
                    dependency,
                    {},
                    context({ signal: controller.signal }),
                )
            ).status,
        ).toBe("cancelled");
        expect(calls).toHaveLength(0);
    });

    it("denies use after the owning host session disposes the adapter", async () => {
        adapter.dispose();
        expect((await execute()).status).toBe("denied");
        expect(calls).toHaveLength(0);
    });

    it("rejects nested adapter wrappers rather than invoking duplicate host effects", async () => {
        const original = host.invokeCapability;
        let nestedStatus: string | undefined;
        host.invokeCapability = async (capability, input, ctx) => {
            if (capability.operation === tools.execute.operation) {
                nestedStatus = (await execute()).status;
            }
            return original(capability, input, ctx);
        };
        expect((await execute()).status).toBe("completed");
        expect(nestedStatus).toBe("denied");
        expect(calls).toHaveLength(2);
    });

    it("keeps native-only calls usable when the optional backend is absent", async () => {
        available = false;
        expect((await adapter.preflight([dependency], context())).status).toBe(
            "unavailable",
        );
        expect((await execute()).status).toBe("unavailable");
        // Independent native capability fixture: no adapter startup or discovery.
        const nativeHost: RecipeHost = {
            ...host,
            invokeCapability: async () => ({
                status: "completed",
                value: "native",
            }),
        };
        expect(
            await nativeHost.invokeCapability(
                {
                    ...tools.search,
                    transport: "native",
                    operation: "native-read",
                },
                null,
                context(),
            ),
        ).toEqual({ status: "completed", value: "native" });
        expect(calls).toHaveLength(0);
    });

    it("composes a fixture-only mixed native/MCP read sequence, not a P3 executable proof", async () => {
        const original = host.invokeCapability;
        host.invokeCapability = async (capability, input, ctx) =>
            capability.transport === "native"
                ? {
                      status: "completed",
                      value: { text: "native fixture value" },
                  }
                : original(capability, input, ctx);
        expect((await adapter.preflight([dependency], context())).status).toBe(
            "completed",
        );
        const native = await host.invokeCapability(
            { ...tools.search, transport: "native", operation: "native-read" },
            null,
            context(),
        );
        if (native.status !== "completed") throw new Error("fixture");
        const result = await adapter.execute(
            dependency,
            { native: native.value },
            context(),
        );
        expect(result.status).toBe("completed");
        expect(calls[2].input).toHaveProperty("parameters", {
            native: { text: "native fixture value" },
        });
    });

    it("bounds outstanding interactions without preventing explicit cancellation", async () => {
        reply = pending();
        let first: string | undefined;
        for (let i = 0; i < 32; i++) {
            const result = await execute();
            expect(result.status).toBe("requires_interaction");
            if (result.status === "requires_interaction") {
                first ??= result.interactionId;
            }
        }
        expect((await execute()).status).toBe("unavailable");
        expect(calls).toHaveLength(64);
        reply = completed();
        expect(
            (await adapter.cancelAction(first!, { source: "user" }, context()))
                .status,
        ).toBe("completed");
    });

    it("does not replay lost replies or duplicate wrapper calls", async () => {
        const ctx = context();
        throwAfterDispatch = true;
        expect((await adapter.execute(dependency, {}, ctx)).status).toBe(
            "execution_uncertain",
        );
        expect((await adapter.execute(dependency, {}, ctx)).status).toBe(
            "denied",
        );
        expect(calls).toHaveLength(2);
    });

    it("consumes a user answer before a lost continuation reply", async () => {
        reply = pending();
        const outcome = await execute();
        if (outcome.status !== "requires_interaction")
            throw new Error("fixture");
        throwAfterDispatch = true;
        const user = {
            source: "user" as const,
            response: { type: "question" as const, selected: 1 },
        };
        expect(
            (
                await adapter.continueAction(
                    outcome.interactionId,
                    user,
                    context(),
                )
            ).status,
        ).toBe("execution_uncertain");
        expect(
            (
                await adapter.continueAction(
                    outcome.interactionId,
                    user,
                    context(),
                )
            ).status,
        ).toBe("denied");
        expect(calls).toHaveLength(3);
    });

    it.each(["runRecipe", "runMacro", "processCommand", "executeAction"])(
        "rejects recursive %s wrappers before discovery",
        async (actionName) => {
            expect(
                (
                    await adapter.execute(
                        { ...dependency, actionName },
                        {},
                        context(),
                    )
                ).status,
            ).toBe("unavailable");
            expect(calls).toHaveLength(0);
        },
    );

    it("preserves pre-dispatch transport absence versus uncertain submission", async () => {
        backendError = new StructuredActionClientError(
            false,
            "conversation_changed",
        );
        expect((await execute()).status).toBe("unavailable");
        backendError = new StructuredActionClientError(
            true,
            "delivery_uncertain",
        );
        expect((await execute()).status).toBe("execution_uncertain");
        expect(
            calls.filter((call) => call.operation === tools.execute.operation),
        ).toHaveLength(2);
    });

    it.each([
        { content: [{ type: "text", text: '{"status":"completed"}' }] },
        { structuredContent: { status: "completed" } },
        { structuredContent: completed(), isError: true },
    ])(
        "does not infer success from malformed or conflicting envelopes",
        async (value) => {
            const original = host.invokeCapability;
            host.invokeCapability = async (capability, input, ctx) =>
                capability.operation === tools.search.operation
                    ? original(capability, input, ctx)
                    : { status: "completed", value: value as JsonValue };
            expect((await execute()).status).toBe("execution_uncertain");
        },
    );
});
