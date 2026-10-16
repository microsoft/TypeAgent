// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ReplayToolDescriptor,
    ReplayToolHost,
} from "@typeagent/copilot-macros";
import {
    recipeDigest,
    recipeRuntimeAbi,
    recipeSchemaDigest,
    sealRecipeArtifact,
    type RecipeArtifact,
} from "@typeagent/copilot-macros/recipeCore";
import {
    createTypeAgentRecipeHost,
    recipeCapabilityFromTool,
} from "../src/recipeToolHost.js";

const descriptor: ReplayToolDescriptor = {
    mcpServerName: "documents",
    toolName: "read",
    readOnly: true,
    schemaFingerprint: recipeDigest("current-schema"),
    inputSchema: {
        type: "object",
        description: "Read a current document",
        properties: { path: { type: "string", description: "Path" } },
        required: ["path"],
    },
};

function artifact(): RecipeArtifact {
    const source = "Host adapter fixture, never evaluated.";
    return sealRecipeArtifact({
        recipeId: "read",
        schemaVersion: 1,
        kind: "program",
        name: "Read",
        description: "Read current data.",
        execution: "symbolic",
        authorization: "live_host",
        source: {
            language: "typescript",
            text: source,
            digest: recipeDigest(source),
        },
        executable: {
            language: "javascript",
            text: source,
            digest: recipeDigest(source),
            sourceDigest: recipeDigest(source),
            compiler: {
                name: "fixture",
                version: "1",
                optionsDigest: "fixture",
            },
            runtimeAbi: recipeRuntimeAbi,
        },
        inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
            additionalProperties: false,
        },
        outputSchema: { type: "string" },
        output: {
            kind: "value",
            requirements: ["Current data"],
            identity: "current_run",
        },
        capabilities: [recipeCapabilityFromTool(descriptor)],
        semanticFunctions: [],
        applicability: { assumptions: ["Read-only"], unsupported: ["Write"] },
        generalization: [],
        specification: {
            id: "spec",
            revision: "1",
            intent: "Read current document",
            outputRequirements: ["Current data"],
            rubric: "Exact",
            counterexamples: ["Write"],
        },
        matching: {
            grammar: ['<Start> = read -> { path: "alpha" };'],
            examples: [
                {
                    request: "read",
                    input: { path: "alpha" },
                    evidenceIds: ["recorded"],
                },
            ],
            negatives: ["write"],
            collisionEvidenceIds: [],
        },
        provenance: {
            captureId: "capture",
            taskId: "task",
            tokenId: "token",
            evidenceIds: ["recorded"],
        },
        fixtures: [
            {
                id: "fixture",
                origin: "observed",
                result: "passed",
                specificationRevision: "1",
                noLiveEffects: true,
            },
        ],
        createdAt: "2026-10-15T20:00:00Z",
    });
}

const binding = {
    workspaceId: "workspace",
    profileId: "typeagent",
    providerId: "typeagent",
    accountId: "live-host",
    sessionId: "session",
    generation: "generation",
};
const call = {
    runId: "run",
    callId: "call",
    binding,
    signal: new AbortController().signal,
};

describe("TypeAgent recipe tool adapter", () => {
    it("binds actual schemas without inventing an output type or permission", () => {
        const capability = recipeCapabilityFromTool(descriptor);
        expect(capability.inputSchema).toEqual({
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
            additionalProperties: false,
        });
        expect(capability.outputSchema).toBeUndefined();
        expect(capability.schemaDigest).toBe(
            recipeSchemaDigest(capability.inputSchema),
        );
        expect(capability.contractVersion).toBe(
            `mcp-tool-v1:${descriptor.schemaFingerprint}`,
        );
        expect(capability.effect).toBe("read");
        expect(
            recipeCapabilityFromTool({ ...descriptor, readOnly: false }).effect,
        ).toBe("unknown");
        expect(() =>
            recipeCapabilityFromTool({
                toolName: descriptor.toolName,
                schemaFingerprint: descriptor.schemaFingerprint,
                inputSchema: descriptor.inputSchema,
            }),
        ).toThrow("native tools need a session broker");
    });

    it("preflights once per run and returns fresh structured tool results", async () => {
        let inspections = 0;
        let calls = 0;
        const replay: ReplayToolHost = {
            inspectTool: async () => {
                inspections++;
                return descriptor;
            },
            callTool: async (_server, _tool, args) => ({
                args,
                current: ++calls,
            }),
        };
        const recipe = artifact();
        const host = createTypeAgentRecipeHost(recipe, replay, "C:\\workspace");
        const capability = recipe.capabilities[0];
        expect((await host.inspectCapability(capability, binding)).status).toBe(
            "available",
        );
        expect((await host.inspectCapability(capability, binding)).status).toBe(
            "available",
        );
        expect(inspections).toBe(1);
        expect(
            await host.invokeCapability(capability, { path: "beta" }, call),
        ).toEqual({
            status: "completed",
            value: { args: { path: "beta" }, current: 1 },
        });
        expect(
            await host.invokeCapability(capability, { path: "gamma" }, call),
        ).toEqual({
            status: "completed",
            value: { args: { path: "gamma" }, current: 2 },
        });
    });

    it("rejects drift, unpreflighted tools, and effectful capabilities without dispatch", async () => {
        let calls = 0;
        const replay: ReplayToolHost = {
            inspectTool: async () => ({
                ...descriptor,
                schemaFingerprint: "changed",
            }),
            callTool: async () => {
                calls++;
                return {};
            },
        };
        const recipe = artifact();
        const host = createTypeAgentRecipeHost(recipe, replay, "C:\\workspace");
        const capability = recipe.capabilities[0];
        expect((await host.inspectCapability(capability, binding)).status).toBe(
            "unsupported",
        );
        expect(
            (await host.invokeCapability(capability, { path: "beta" }, call))
                .status,
        ).toBe("unsupported");
        expect(
            (
                await host.inspectCapability(
                    { ...capability, effect: "write" },
                    binding,
                )
            ).status,
        ).toBe("unsupported");
        expect(calls).toBe(0);
    });

    it("reports loss of a dispatched reply as uncertain rather than success or replay", async () => {
        const replay: ReplayToolHost = {
            inspectTool: async () => descriptor,
            callTool: async () => {
                throw new Error("Backend reply lost.");
            },
        };
        const recipe = artifact();
        const host = createTypeAgentRecipeHost(recipe, replay, "C:\\workspace");
        await host.inspectCapability(recipe.capabilities[0], binding);
        expect(
            await host.invokeCapability(
                recipe.capabilities[0],
                { path: "beta" },
                call,
            ),
        ).toMatchObject({
            status: "execution_uncertain",
            operationId: "call",
            message: "Backend reply lost.",
        });
    });

    it("rejects unsupported schemas instead of silently weakening their constraints", () => {
        expect(() =>
            recipeCapabilityFromTool({
                ...descriptor,
                inputSchema: {
                    type: "object",
                    properties: { name: { type: "string", pattern: "^a" } },
                },
            }),
        ).toThrow("Unsupported recipe schema keyword: pattern");
    });
});
