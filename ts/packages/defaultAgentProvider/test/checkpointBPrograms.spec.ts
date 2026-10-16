// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
    MacroManager,
    type MacroLearningBuild,
    type MacroLearningJob,
    type RecordedInteractionTrace,
} from "@typeagent/copilot-macros";
import {
    recipeDigest,
    recipeSchemaDigest,
    validateRecipeArtifact,
    type RecipeCapability,
    type RecipeHost,
    type RuntimeJsonSchema,
} from "@typeagent/copilot-macros/recipeCore";
import { executeRecipeProgram } from "@typeagent/copilot-macros/recipeExecutor";
import type { MacroProgramFixturePlan } from "../src/macroProgramAuthoring.js";

const aiclient = await import("@typeagent/aiclient");
const defaultModel = jest.fn<() => never>(() => {
    throw new Error("No default or fallback model may run in this test.");
});
jest.unstable_mockModule("@typeagent/aiclient", () => ({
    ...aiclient,
    openai: { ...aiclient.openai, createChatModel: defaultModel },
}));
const { createMacroLearningRuntime } = await import(
    "../src/macroLearningRuntime.js"
);
const { createMacroProgramAuthor } = await import(
    "../src/macroProgramAuthoring.js"
);

it("publishes a context-bound externally authored program through real learning and independent validation", async () => {
    const cwd = path.resolve(".checkpoint-b-tests", randomUUID());
    await mkdir(cwd, { recursive: true });
    const inputSchema: RuntimeJsonSchema = {
        type: "object",
        properties: { step_1_path: { type: "string" } },
        required: ["step_1_path"],
        additionalProperties: false,
    };
    const toolInput: RuntimeJsonSchema = {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
    };
    const outputSchema: RuntimeJsonSchema = {
        type: "object",
        properties: { body: { type: "string" } },
        required: ["body"],
        additionalProperties: false,
    };
    const capability: RecipeCapability = {
        id: "read",
        transport: "mcp",
        providerId: "files",
        operation: "read",
        contractVersion: "1",
        inputSchema: toolInput,
        outputSchema,
        schemaDigest: recipeSchemaDigest(toolInput, outputSchema),
        compatibility: "exact",
        effect: "read",
    };
    const source = `async function execute(api: RecipeApi, params: JsonValue): Promise<JsonValue> {
        const { step_1_path } = params as { step_1_path: string };
        return await api.tools.call("read", { path: step_1_path });
    }`;
    const plan: MacroProgramFixturePlan = {
        inputSchema,
        outputSchema,
        specification: {
            id: "read-file",
            revision: "1",
            intent: "Read the requested current file",
            outputRequirements: ["Return the structured current file body"],
            rubric: "Read the supplied path and return its current result",
            counterexamples: ["Do not return recorded file contents"],
        },
        semanticFunctions: [],
        applicability: { assumptions: [], unsupported: ["File writes"] },
        fixtures: [
            {
                id: "observed",
                origin: "observed",
                input: { step_1_path: "alpha.txt" },
                calls: [
                    {
                        kind: "capability",
                        id: "read",
                        input: { path: "alpha.txt" },
                        output: { body: "Recorded alpha contents" },
                    },
                ],
                expectedOutput: { body: "Recorded alpha contents" },
            },
            {
                id: "independent",
                origin: "independent",
                input: { step_1_path: "beta.txt" },
                calls: [
                    {
                        kind: "capability",
                        id: "read",
                        input: { path: "beta.txt" },
                        output: { body: "Independent beta contents" },
                    },
                ],
                expectedOutput: { body: "Independent beta contents" },
            },
        ],
    };
    const businessTool = jest.fn<() => Promise<never>>(async () => {
        throw new Error("Authoring must not invoke a business tool.");
    });
    const inspector = jest.fn(async () => capability);
    let verifierCalls = 0;
    const verifier = jest.fn<(prompt: string) => Promise<string>>(
        async (prompt) => {
            verifierCalls++;
            expect(prompt).toContain(
                "independent recording-to-program verifier",
            );
            expect(prompt).not.toContain(source);
            const evidence = JSON.parse(prompt.split("\nEVIDENCE:\n")[1]);
            expect(evidence.macro).not.toHaveProperty("program");
            return JSON.stringify({
                ...plan,
                specification: {
                    ...plan.specification,
                    revision: String(verifierCalls),
                },
            });
        },
    );
    const transport = {
        inspectTool: async () => ({
            toolName: "read",
            schemaFingerprint: "read-v1",
            readOnly: true,
        }),
        callTool: businessTool,
    };
    let manager = new MacroManager(cwd, transport);
    async function configure() {
        await manager.configureLearning(
            createMacroLearningRuntime(
                undefined,
                () => manager.getApprovedMacros(),
                undefined,
                createMacroProgramAuthor({
                    inspectCapability: inspector,
                    query: verifier,
                }),
            ),
        );
    }
    try {
        await configure();
        await manager.setMacroLearningPreference({ cwd, mode: "all" });
        const trace: RecordedInteractionTrace = {
            schemaVersion: 1,
            sessionId: "source",
            cwd,
            prompt: "read file alpha.txt for me",
            response: '{"body":"Recorded alpha contents"}',
            startedAt: "2026-10-15T00:00:00.000Z",
            completedAt: "2026-10-15T00:00:01.000Z",
            toolCalls: [
                {
                    toolCallId: "read-call",
                    name: "read",
                    mcpServerName: "files",
                    arguments: { path: "alpha.txt" },
                    result: { body: "Recorded alpha contents" },
                    status: "completed",
                },
            ],
        };
        const token = manager.armRecording({
            sessionId: trace.sessionId,
            cwd,
            learning: true,
        });
        manager.claimRecording({
            sessionId: trace.sessionId,
            cwd,
            promptHash: createHash("sha256").update(trace.prompt).digest("hex"),
        });
        const summary = await manager.finalizeRecording({
            tokenId: token.id,
            trace,
            childAuthoring: {
                taskId: `${trace.sessionId}:first`,
                firstEventId: "first",
                successEventId: "receipt",
                outputEventId: "final",
                recordingTokenId: token.id,
            },
        });
        expect(summary.learningJobId).toBeDefined();
        const jobId = summary.learningJobId!;
        const phases: string[] = [];
        const children = new Set<string>();
        const deadline = Date.now() + 20_000;
        let job: MacroLearningJob = await manager.getMacroLearningJob(jobId);
        while (job.status !== "ready" && Date.now() < deadline) {
            if (job.status === "failed" || job.status === "cancelled")
                throw new Error(JSON.stringify(job));
            if (job.status === "awaitingAuthor") {
                const claim = { cwd, sessionId: "host", workerId: "worker" };
                const request = await manager.claimMacroAuthoringRequest(claim);
                if (request) {
                    expect(children.size).toBeLessThan(12);
                    expect(request.contextDigest).toMatch(/^[a-f0-9]{64}$/);
                    expect(request.promptDigest).toBe(
                        recipeDigest(request.prompt),
                    );
                    let response: unknown;
                    if (request.prompt.startsWith("Extract a procedural")) {
                        phases.push("extract");
                        response = {
                            schemaVersion: 1,
                            traceId: summary.traceId,
                            request: trace.prompt,
                            toolCallIds: ["read-call"],
                            description: "Read the current requested file",
                            uncertainties: [],
                        };
                    } else if (request.prompt.startsWith("Build a reusable")) {
                        phases.push("build");
                        const { baseline } = JSON.parse(
                            request.prompt.split("\nEVIDENCE:\n")[1],
                        );
                        response = {
                            name: baseline.name,
                            description: baseline.description,
                            inputs: baseline.inputs,
                            steps: baseline.steps,
                            exampleInputs: { step_1_path: "alpha.txt" },
                            requests: ["read", "show", "open", "display"].map(
                                (verb) => `${verb} file alpha.txt for me`,
                            ),
                        } satisfies MacroLearningBuild;
                    } else if (request.prompt.startsWith("Author a reusable")) {
                        phases.push("source");
                        expect(request.prompt).not.toContain(
                            "Independent beta contents",
                        );
                        response = { source };
                        expect(verifier).toHaveBeenCalledTimes(1);
                        manager = new MacroManager(cwd, transport);
                        await configure();
                    } else {
                        phases.push("grammar");
                        expect(request.prompt).toContain(
                            "MACRO GRAMMAR REQUIREMENTS:",
                        );
                        response = {
                            shouldGenerateGrammar: true,
                            requestAnalysis: { sentences: [] },
                            parameterMappings: [
                                {
                                    parameterName: "step_1_path",
                                    sourceText: "alpha.txt",
                                    targetValue: "alpha.txt",
                                    isWildcard: true,
                                },
                            ],
                            fixedPhrases: ["file", "for me"],
                            grammarPattern: {
                                matchPattern:
                                    "(read | show | open | display) file $(step_1_path:string) for me",
                                actionParameters: [
                                    {
                                        parameterName: "step_1_path",
                                        parameterValue: "step_1_path",
                                    },
                                ],
                            },
                            reasoning: "Preserve fixed request boundaries.",
                        };
                    }
                    const childId = `isolated-${children.size}`;
                    children.add(childId);
                    await manager.submitMacroAuthoringResponse({
                        ...claim,
                        requestId: request.requestId,
                        leaseId: request.leaseId,
                        promptDigest: request.promptDigest,
                        outcome: {
                            status: "completed",
                            text: JSON.stringify(response),
                            childId,
                        },
                    });
                }
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
            job = await manager.getMacroLearningJob(jobId);
        }
        expect(job.status).toBe("ready");
        expect(phases).toEqual([
            "extract",
            "build",
            "grammar",
            "grammar",
            "grammar",
            "grammar",
            "source",
        ]);
        const approved = await manager.getApprovedMacros();
        expect(approved).toHaveLength(1);
        const macro = approved[0];
        const artifact = macro.program!;
        expect(validateRecipeArtifact(artifact)).toEqual([]);
        expect(artifact.source.text).toBe(source);
        expect(artifact.fixtures.map((fixture) => fixture.origin)).toEqual([
            "observed",
            "independent",
        ]);
        expect(
            artifact.fixtures.every((fixture) => fixture.noLiveEffects),
        ).toBe(true);
        expect(artifact.provenance).toMatchObject({
            captureId: summary.traceId,
            taskId: "source:first",
            tokenId: token.id,
            legacySource: {
                macroId: macro.macroId,
                version: macro.version - 1,
            },
        });
        expect(artifact.provenance.evidenceIds).toContain(
            macro.learning!.authoring!.contextDigest,
        );
        expect(verifier).toHaveBeenCalledTimes(1);
        expect(inspector).toHaveBeenCalled();
        expect(businessTool).not.toHaveBeenCalled();
        expect(defaultModel).not.toHaveBeenCalled();
        const invoke = jest.fn<RecipeHost["invokeCapability"]>(
            async (_cap, input) => {
                expect(input).toEqual({ path: "gamma.txt" });
                return {
                    status: "completed",
                    value: { body: "Fresh gamma contents" },
                };
            },
        );
        const result = await executeRecipeProgram(
            artifact,
            { step_1_path: "gamma.txt" },
            {
                runId: "fresh-run",
                signal: new AbortController().signal,
                binding: {
                    workspaceId: cwd,
                    profileId: "test",
                    providerId: "files",
                    accountId: "test",
                    sessionId: "fresh-session",
                    generation: "fresh",
                },
                host: {
                    inspectCapability: async () => ({
                        status: "available",
                        capability,
                    }),
                    invokeCapability: invoke,
                    invokeSemantic: async () => {
                        throw new Error("No semantic calls are declared.");
                    },
                },
            },
        );
        expect(result.status).toBe("completed");
        expect(result.output).toEqual({ body: "Fresh gamma contents" });
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(defaultModel).not.toHaveBeenCalled();
    } finally {
        await manager.setMacroLearningPreference({ cwd, mode: "off" });
        await rm(cwd, { recursive: true, force: true });
        await rm(path.dirname(cwd)).catch(() => undefined);
    }
}, 30_000);
