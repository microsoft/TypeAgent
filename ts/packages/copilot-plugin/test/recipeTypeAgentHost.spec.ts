// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { StructuredActionClient } from "@typeagent/agent-server-client";
import type {
    ActionContract,
    StructuredActionExecutionResult,
} from "@typeagent/dispatcher-types";
import type { RecordedInteractionTrace } from "@typeagent/copilot-macros";
import { compileRecipeProgram } from "@typeagent/copilot-macros/recipeCompiler";
import { executeRecipeProgram } from "@typeagent/copilot-macros/recipeExecutor";
import {
    recipeDigest,
    sealRecipeArtifact,
    type RecipeCapability,
} from "@typeagent/copilot-macros/recipeCore";
import { getRecipeActionParametersSchema } from "@typeagent/copilot-macros/macroSchema";
import { registerStructuredActionTools } from "../src/mcp/structuredActionTools.js";
import { recipeTypeAgentTools } from "../src/shared/recipe-typeagent.js";
import { typeAgentJson } from "../src/shared/recipe-typeagent-protocol.js";
import {
    captureNativeRecipeBinding,
    type NativeRecipeSession,
} from "../src/extension/recipe-native-host.js";
import {
    createNativeTypeAgentRecipeHost,
    prepareTypeAgentRecording,
    typeAgentActionCapability,
    createTypeAgentRecordingNormalizer,
} from "../src/extension/recipe-typeagent-host.js";
import { createNativeTypeAgentInteraction } from "../src/extension/recipe-typeagent-interaction.js";
import { nativeFixture } from "./recipeNativeFixtures.js";

const contract: ActionContract = {
    schemaName: "fixture",
    actionName: "read",
    description: "Synthetic read.",
    input: {
        format: "typescript",
        typeName: "Read",
        schemaText:
            'export type Read = { actionName: "read"; parameters: { text: string; extra?: boolean } };',
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
const semantics = {
    invokeSemantic: async () => ({
        status: "unsupported" as const,
        message: "No models.",
    }),
};

function artifact(capabilities: RecipeCapability[], source: string) {
    return sealRecipeArtifact({
        schemaVersion: 1,
        kind: "program",
        recipeId: "mixed",
        name: "mixed",
        description: "Offline mixed proof.",
        execution: "symbolic",
        authorization: "live_host",
        source: {
            language: "typescript",
            text: source,
            digest: recipeDigest(source),
        },
        executable: compileRecipeProgram(source),
        inputSchema: { type: "null" },
        outputSchema: { type: "string" },
        output: {
            kind: "value",
            requirements: ["Fresh"],
            identity: "current_run",
        },
        capabilities,
        semanticFunctions: [],
        applicability: { assumptions: [], unsupported: [] },
        generalization: [],
        specification: {
            id: "spec",
            revision: "1",
            intent: "Read",
            outputRequirements: ["Fresh"],
            rubric: "Exact",
            counterexamples: ["Write"],
        },
        matching: {
            grammar: ["<Start> = fixture -> {};"],
            examples: [
                { request: "fixture", input: null, evidenceIds: ["evidence"] },
            ],
            negatives: ["write"],
            collisionEvidenceIds: [],
        },
        provenance: {
            captureId: "capture",
            taskId: "capture",
            tokenId: "capture",
            evidenceIds: ["evidence"],
        },
        fixtures: [
            {
                id: "fixture",
                origin: "synthetic",
                result: "passed",
                specificationRevision: "1",
                noLiveEffects: true,
            },
        ],
        createdAt: "2026-10-15T00:00:00Z",
    });
}

describe("plugin-owned TypeAgent actions through the native host and shared executable", () => {
    let server: McpServer;
    let client: Client;
    let session: NativeRecipeSession;
    let scope: string;
    let available: boolean;
    let reply: StructuredActionExecutionResult["status"];
    let loseReply: boolean;
    let currentContract: ActionContract;
    let calls: { name: string; input: unknown }[];
    let nativeCalls: number;
    let searches: number;
    let userAnswer: unknown;

    function result(): StructuredActionExecutionResult {
        const common = {
            protocolVersion: 1 as const,
            scopeId: scope,
            operationId: "private-operation",
            output: ["fresh output"],
            results: [
                {
                    action: { schemaName: "fixture", actionName: "read" },
                    result: { resultValue: "fresh", entities: [] },
                },
            ],
        };
        if (reply === "completed") return { ...common, status: reply };
        if (reply === "requires_interaction")
            return {
                ...common,
                status: reply,
                interactionId: "private-interaction",
                expiresAt: Date.now() + 60_000,
                prompt: {
                    type: "question",
                    message: "Choose",
                    choices: ["one", "two"],
                    defaultId: 0,
                },
            };
        return {
            ...common,
            status: reply,
            error: { code: "execution_failed", message: "Controlled outcome." },
        };
    }
    const expectedOutput = () =>
        JSON.stringify({ output: result().output, results: result().results });
    beforeEach(async () => {
        scope = "current-scope";
        available = true;
        reply = "completed";
        loseReply = false;
        currentContract = structuredClone(contract);
        calls = [];
        nativeCalls = 0;
        searches = 0;
        userAnswer = { answer: "2. two" };
        const backend = {
            binding: {},
            searchActions: async () => {
                searches++;
                return {
                    protocolVersion: 1,
                    scopeId: scope,
                    actions: [currentContract],
                };
            },
            executeAction: async (input: unknown) => {
                calls.push({ name: "execute", input });
                return result();
            },
            continueAction: async (input: unknown) => {
                calls.push({ name: "continue", input });
                reply = "completed";
                return result();
            },
            cancelAction: async (input: unknown) => {
                calls.push({ name: "cancel", input });
                reply = "cancelled";
                return result();
            },
        } as unknown as StructuredActionClient;
        server = new McpServer({ name: "fixture", version: "1" });
        registerStructuredActionTools(server, backend, () => "mcp");
        client = new Client({ name: "fixture-client", version: "1" });
        const [a, b] = InMemoryTransport.createLinkedPair();
        await server.connect(b);
        await client.connect(a);
        const fixture = nativeFixture();
        const catalog = (await client.listTools()).tools;
        session = {
            ...fixture.session,
            rpc: {
                ...fixture.session.rpc,
                tools: {
                    ...fixture.session.rpc.tools,
                    getCurrentMetadata: async () => ({
                        tools: [
                            ...fixture.tools,
                            {
                                name: "ask_user",
                                description: "Actual fixture host UI",
                                input_schema: {},
                            },
                            ...(available
                                ? catalog.map((tool) => {
                                      const schema = typeAgentJson(
                                          tool.inputSchema,
                                      );
                                      if (
                                          !schema ||
                                          typeof schema !== "object" ||
                                          Array.isArray(schema)
                                      )
                                          throw new Error(
                                              "Expected an MCP input object.",
                                          );
                                      return {
                                          name: `mcp-fixture-${tool.name}`,
                                          mcpServerName: "fixture",
                                          mcpToolName: tool.name,
                                          description: tool.description ?? "",
                                          input_schema: schema,
                                      };
                                  })
                                : []),
                        ],
                    }),
                    execute: async ({ name, arguments: args }) => {
                        if (name === "view") {
                            nativeCalls++;
                            return {
                                resultType: "success",
                                textResultForLlm: "native",
                            };
                        }
                        if (name === "ask_user")
                            return {
                                resultType: "success",
                                textResultForLlm: JSON.stringify(userAnswer),
                            };
                        const value = await client.callTool({
                            name: name.slice("mcp-fixture-".length),
                            arguments: args as Record<string, unknown>,
                        });
                        if (
                            loseReply &&
                            name.endsWith(recipeTypeAgentTools.execute)
                        )
                            throw new Error("Lost after dispatch.");
                        return {
                            resultType: value.isError ? "failure" : "success",
                            textResultForLlm: JSON.stringify(
                                value.structuredContent,
                            ),
                        };
                    },
                },
            },
        };
    });
    afterEach(async () => {
        await client.close();
        await server.close();
    });

    it("uses one current discovery per inspection without duplicating lexical preflight", async () => {
        const binding = await captureNativeRecipeBinding(session);
        const bridge = createNativeTypeAgentRecipeHost(
            session,
            binding,
            semantics,
        );
        try {
            await expect(
                bridge.inspectTool({
                    mcpServerName: "fixture",
                    toolName: typeAgentActionCapability("fixture", contract)
                        .operation,
                }),
            ).resolves.toMatchObject({ status: "available" });
            expect(searches).toBe(1);
            expect(calls).toEqual([]);
            expect(nativeCalls).toBe(0);
        } finally {
            await bridge.dispose();
        }
    });

    it("rejects recursive action identities before issuing any program call", () => {
        expect(() =>
            typeAgentActionCapability("fixture", {
                ...contract,
                schemaName: "macro",
            }),
        ).toThrow("Recursive");
        expect(calls).toEqual([]);
    });

    async function run(options: { mixed?: boolean; interact?: boolean } = {}) {
        const binding = await captureNativeRecipeBinding(session);
        const bridge = createNativeTypeAgentRecipeHost(
            session,
            binding,
            semantics,
            { timeoutMs: 1000 },
            options.interact
                ? createNativeTypeAgentInteraction(session, binding)
                : undefined,
        );
        try {
            const action = typeAgentActionCapability("fixture", contract);
            const view = await bridge.inspectTool({ toolName: "view" });
            if (view.status !== "available") throw new Error(view.message);
            const source = `async function execute(api, params) {
                ${options.mixed ? `await api.tools.call(${JSON.stringify(view.capability.id)}, {path:"fixture"});` : ""}
                const data = await api.tools.call(${JSON.stringify(action.id)}, {text:"fresh"});
                return JSON.stringify(data);
            }`;
            return await executeRecipeProgram(
                artifact(
                    options.mixed ? [view.capability, action] : [action],
                    source,
                ),
                null,
                {
                    runId: "run",
                    binding,
                    signal: new AbortController().signal,
                    host: bridge.host,
                },
                { timeoutMs: 3000 },
            );
        } finally {
            await bridge.dispose();
        }
    }

    it("executes a mixed contained program using the existing structured MCP tools", async () => {
        expect(await run({ mixed: true })).toMatchObject({
            status: "completed",
            output: expectedOutput(),
        });
        expect(nativeCalls).toBe(1);
        expect(calls).toEqual([
            {
                name: "execute",
                input: {
                    protocolVersion: 1,
                    scopeId: scope,
                    schemaName: "fixture",
                    actionName: "read",
                    parameters: { text: "fresh" },
                },
            },
        ]);
    });
    it("preflights a missing TypeAgent dependency before even the first native call", async () => {
        available = false;
        expect((await run({ mixed: true })).status).toBe("unavailable");
        expect(nativeCalls).toBe(0);
        expect(calls).toHaveLength(0);
    });
    it("resolves a new scope after restart, without persisting the old scope", async () => {
        await run();
        scope = "new-scope";
        await run();
        expect(calls[1].input).toMatchObject({ scopeId: "new-scope" });
        expect(
            JSON.stringify(typeAgentActionCapability("fixture", contract)),
        ).not.toContain("scopeId");
    });
    it("rejects a changed contract before any mixed call", async () => {
        currentContract.policy.confirmation = "required";
        expect((await run({ mixed: true })).status).toBe("unsupported");
        expect(nativeCalls).toBe(0);
        expect(calls).toHaveLength(0);
    });
    it.each([
        "failed",
        "cancelled",
        "unavailable",
        "execution_uncertain",
    ] as const)(
        "preserves authoritative %s even with MCP/native error flags",
        async (status) => {
            reply = status;
            expect((await run()).status).toBe(status);
            expect(calls).toHaveLength(1);
        },
    );
    it("does not retry or declare success after a lost action reply", async () => {
        loseReply = true;
        expect((await run()).status).toBe("execution_uncertain");
        expect(calls).toHaveLength(1);
    });
    it("does not invent a default response when no host UI is connected", async () => {
        reply = "requires_interaction";
        expect((await run()).status).toBe("requires_interaction");
        expect(calls).toHaveLength(1);
    });
    it("continues inside the same executable only with the actual native user's choice", async () => {
        reply = "requires_interaction";
        expect(await run({ interact: true })).toMatchObject({
            status: "completed",
            output: expectedOutput(),
        });
        expect(calls[1]).toMatchObject({
            name: "continue",
            input: {
                scopeId: scope,
                operationId: "private-operation",
                interactionId: "private-interaction",
                response: { type: "question", selected: 1 },
            },
        });
    });
    it("forwards explicit user cancellation without continuing or replaying", async () => {
        reply = "requires_interaction";
        userAnswer = { answer: "Cancel this action" };
        expect((await run({ interact: true })).status).toBe("cancelled");
        expect(calls.map((call) => call.name)).toEqual(["execute", "cancel"]);
    });
    it("does not use an invalid or missing user answer as approval", async () => {
        reply = "requires_interaction";
        userAnswer = { answer: "" };
        expect((await run({ interact: true })).status).not.toBe("completed");
        expect(calls).toHaveLength(1);
    });
    it("keeps native-only execution functional with no TypeAgent server", async () => {
        available = false;
        const binding = await captureNativeRecipeBinding(session);
        const bridge = createNativeTypeAgentRecipeHost(
            session,
            binding,
            semantics,
        );
        try {
            const found = await bridge.inspectTool({ toolName: "view" });
            if (found.status !== "available") throw new Error(found.message);
            expect(found.capability.id).toBe("native:copilot-native/view");
            const program = artifact(
                [found.capability],
                'async function execute(api, params) { return await api.tools.call("native:copilot-native/view", {path:"fixture"}); }',
            );
            expect(
                (
                    await executeRecipeProgram(program, null, {
                        runId: "native-only",
                        binding,
                        host: bridge.host,
                        signal: new AbortController().signal,
                    })
                ).status,
            ).toBe("completed");
        } finally {
            await bridge.dispose();
        }
    });
    it("records only stable action identity, parameters and current output", () => {
        const trace: RecordedInteractionTrace = {
            schemaVersion: 1,
            sessionId: "recording",
            cwd: process.cwd(),
            prompt: "Read fresh",
            response: "fresh",
            startedAt: "start",
            completedAt: "end",
            toolCalls: [
                {
                    toolCallId: "search",
                    name: recipeTypeAgentTools.search,
                    mcpServerName: "fixture",
                    arguments: { query: "read" },
                    status: "completed",
                    result: {
                        protocolVersion: 1,
                        scopeId: scope,
                        actions: [contract],
                    },
                },
                {
                    toolCallId: "execute",
                    name: recipeTypeAgentTools.execute,
                    mcpServerName: "fixture",
                    arguments: {
                        scopeId: scope,
                        schemaName: "fixture",
                        actionName: "read",
                        parameters: { text: "fresh" },
                    },
                    status: "completed",
                    result: result(),
                },
            ],
        };
        const prepared = prepareTypeAgentRecording(trace);
        expect(prepared.toolCalls).toHaveLength(1);
        expect(prepared.toolCalls[0]).toMatchObject({
            name: "typeagent-action/fixture/read",
            arguments: { text: "fresh" },
            result: { output: ["fresh output"], results: result().results },
        });
        for (const field of ["scopeId", "operationId", "interactionId"])
            expect(JSON.stringify(prepared)).not.toContain(field);
        trace.toolCalls[0].result = {
            protocolVersion: 1,
            scopeId: "other",
            actions: [contract],
        };
        expect(() => prepareTypeAgentRecording(trace)).toThrow(
            "exact discovery",
        );
    });
    it("preserves optional fields and referenced closed parameter types", () => {
        expect(
            getRecipeActionParametersSchema(
                'type Params = { text: string; extra?: boolean }; export type Read = { actionName:"read"; parameters:Params };',
                "fixture",
                "Read",
                "read",
            ),
        ).toMatchObject({
            required: ["text"],
            properties: { extra: { type: "boolean" } },
        });
        expect(() =>
            getRecipeActionParametersSchema(
                'type Read = { actionName:"read"; parameters:{value:any} };',
                "fixture",
                "Read",
                "read",
            ),
        ).toThrow();
    });
    it("retains only session-local discovery when a later recording reuses a known scope", () => {
        const normalizer = createTypeAgentRecordingNormalizer();
        normalizer.normalizeToolResult(
            {
                resultType: "success",
                textResultForLlm: JSON.stringify({
                    protocolVersion: 1,
                    scopeId: scope,
                    actions: [contract],
                }),
            },
            { name: recipeTypeAgentTools.search, mcpServerName: "fixture" },
        );
        const trace: RecordedInteractionTrace = {
            schemaVersion: 1,
            sessionId: "recording",
            cwd: process.cwd(),
            prompt: "Read fresh",
            response: "fresh",
            startedAt: "start",
            completedAt: "end",
            toolCalls: [
                {
                    toolCallId: "execute",
                    name: recipeTypeAgentTools.execute,
                    mcpServerName: "fixture",
                    arguments: {
                        scopeId: scope,
                        schemaName: "fixture",
                        actionName: "read",
                        parameters: { text: "fresh" },
                    },
                    status: "completed",
                    result: result(),
                },
            ],
        };
        expect(normalizer.prepareTrace(trace).toolCalls[0].name).toBe(
            "typeagent-action/fixture/read",
        );
        normalizer.clear();
        expect(() => normalizer.prepareTrace(trace)).toThrow("exact discovery");
        expect(
            normalizer.prepareTrace({ ...trace, toolCalls: [] }).toolCalls,
        ).toEqual([]);
    });
});
