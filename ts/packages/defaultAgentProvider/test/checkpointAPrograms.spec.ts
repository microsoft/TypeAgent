// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    loadGrammarRules,
    matchGrammar,
} from "@typeagent/action-grammar/runtime";
import type { ActionContext, AppAction } from "@typeagent/agent-sdk";
import {
    MacroManager,
    type CopilotToolMacro,
    type MacroLearningRuntime,
    type ReplayToolDescriptor,
    type ReplayToolHost,
} from "@typeagent/copilot-macros";
import { compileRecipeProgram } from "@typeagent/copilot-macros/recipeCompiler";
import {
    recipeDigest,
    sealRecipeArtifact,
    type RecipeArtifact,
    type RecipeSemanticFunction,
} from "@typeagent/copilot-macros/recipeCore";
import { executeRecipeProgram } from "@typeagent/copilot-macros/recipeExecutor";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { configureCheckpointAPrograms } from "../src/macroProgramRuntime.js";
import { McpReplayHost } from "../src/mcp/mcpReplayHost.js";
// Link shared aiclient modules before Jest VM evaluates concurrent lazy imports.
import {
    createMacroAppAgentProvider,
    getMacroActionName,
} from "../src/macroAgentProvider.js";
import "../src/recipeModelProvider.js";
import {
    createTypeAgentRecipeHost,
    recipeCapabilityFromTool,
} from "../src/recipeToolHost.js";

const descriptor = {
    mcpServerName: "documents",
    toolName: "read",
    readOnly: true,
    schemaFingerprint: recipeDigest("schema-v1"),
    inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
    },
};
const semantic: RecipeSemanticFunction = {
    id: "classify",
    revision: "1",
    inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
    },
    outputSchema: { type: "string" },
    specification: {
        id: "classification",
        revision: "1",
        task: "Classify the current text.",
        rubric: "Use current text only.",
    },
    modelPolicy: { id: "typeagent-default", revision: "1" },
    bounds: {
        timeoutMs: 5_000,
        maxInputBytes: 4_096,
        maxOutputBytes: 4_096,
        maxCalls: 1,
        maxRepairAttempts: 0,
        maxConcurrency: 1,
    },
    evidence: { sourceIds: "none", quotations: false },
};

function program(
    macro: CopilotToolMacro,
    hybrid: boolean,
    tool: ReplayToolDescriptor = descriptor,
): RecipeArtifact {
    const capability = recipeCapabilityFromTool(tool);
    const text = `
async function execute(api: RecipeApi, params: { step_1_path: string }): Promise<JsonValue> {
    const value = await api.tools.call(${JSON.stringify(capability.id)}, { path: params.step_1_path });
    if (value === null || typeof value !== "object" || Array.isArray(value) || typeof value.content !== "string")
        throw new Error("Current document content is unavailable.");
    ${hybrid ? 'return api.semantic.call("classify", { text: value.content });' : "return value.content;"}
}`;
    return sealRecipeArtifact({
        recipeId: macro.macroId,
        schemaVersion: 1,
        kind: "program",
        name: macro.name,
        description: macro.description,
        execution: hybrid ? "hybrid" : "symbolic",
        authorization: "live_host",
        source: { language: "typescript", text, digest: recipeDigest(text) },
        executable: compileRecipeProgram(text),
        inputSchema: {
            type: "object",
            properties: { step_1_path: { type: "string" } },
            required: ["step_1_path"],
            additionalProperties: false,
        },
        outputSchema: { type: "string" },
        output: {
            kind: "content",
            requirements: ["Current document output"],
            identity: "current_run",
        },
        capabilities: [capability],
        semanticFunctions: hybrid ? [semantic] : [],
        applicability: {
            assumptions: ["Read-only documents"],
            unsupported: ["Writes"],
        },
        generalization: [
            {
                kind: "parameter",
                name: "step_1_path",
                producer: "request",
                evidenceIds: ["recorded"],
            },
        ],
        specification: {
            id: "read-current",
            revision: "1",
            intent: "Read current document",
            outputRequirements: ["Current document output"],
            rubric: "Fresh data only",
            counterexamples: ["Captured text instead of current data"],
        },
        matching: {
            grammar: [
                "<Start> = read file $(step_1_path:string) now -> { step_1_path };",
            ],
            examples: [
                {
                    request: "read file alpha.txt now",
                    input: { step_1_path: "alpha.txt" },
                    evidenceIds: ["recorded"],
                },
            ],
            negatives: ["delete file"],
            collisionEvidenceIds: [],
        },
        provenance: {
            captureId: macro.sourceTraceId,
            taskId: macro.sourceTraceId,
            tokenId: macro.sourceTraceId,
            evidenceIds: ["recorded"],
            legacySource: { macroId: macro.macroId, version: macro.version },
        },
        fixtures: ["observed", "independent"].map((origin) => ({
            id: origin,
            origin: origin as "observed" | "independent",
            result: "passed",
            specificationRevision: "1",
            noLiveEffects: true,
        })),
        createdAt: new Date().toISOString(),
    });
}

describe("Checkpoint A recorded programs with actual contained execution", () => {
    let directory: string;
    let realReplay: McpReplayHost | undefined;
    beforeEach(async () => {
        directory = await mkdtemp(path.join(os.tmpdir(), "checkpoint-a-"));
    });
    afterEach(async () => {
        await realReplay?.close();
        realReplay = undefined;
        await rm(directory, { recursive: true, force: true });
    });

    it("configures program authorship and execution by default without dispatching tools", async () => {
        const manager = new MacroManager(directory);
        const replay: ReplayToolHost = {
            inspectTool: async () => {
                throw new Error("Disabled programs must not inspect tools.");
            },
            callTool: async () => {
                throw new Error("Disabled programs must not dispatch tools.");
            },
        };
        expect(await configureCheckpointAPrograms(manager, replay)).toEqual(
            expect.any(Function),
        );
        expect(manager.canRunPrograms()).toBe(true);
    });

    it.each([
        { hybrid: false, realTools: false },
        { hybrid: true, realTools: false },
        { hybrid: false, realTools: true },
    ])(
        "runs changed grammar/explicit inputs with hybrid=$hybrid realTools=$realTools and no planning runner",
        async ({ hybrid, realTools }) => {
            let toolCalls = 0;
            let modelCalls = 0;
            let tool: ReplayToolDescriptor = descriptor;
            if (realTools) {
                const require = createRequire(import.meta.url);
                const serverEntry = path.join(
                    path.dirname(
                        require.resolve(
                            "@modelcontextprotocol/server-filesystem/package.json",
                        ),
                    ),
                    "dist",
                    "index.js",
                );
                realReplay = new McpReplayHost(directory, {
                    configs: [
                        {
                            id: "documents",
                            name: "documents",
                            enabled: true,
                            trust: "trusted",
                            scope: "workspace",
                            provenance: {
                                source: "synthetic-checkpoint-a-test",
                            },
                            transport: {
                                kind: "stdio",
                                command: process.execPath,
                                args: [serverEntry, directory],
                                cwd: directory,
                            },
                        },
                    ],
                    audit: { write: async () => {} },
                });
                await writeFile(
                    path.join(directory, "alpha.txt"),
                    "captured-alpha",
                );
                await writeFile(
                    path.join(directory, "beta.txt"),
                    'fresh:{"path":"beta.txt"}:1',
                );
                await writeFile(
                    path.join(directory, "gamma.txt"),
                    'fresh:{"path":"gamma.txt"}:2',
                );
                const inspected = await realReplay.inspectTool(
                    "documents",
                    "read_text_file",
                    { cwd: directory },
                );
                if (!inspected)
                    throw new Error("Synthetic MCP read tool is missing.");
                tool = inspected;
            }
            const replay: ReplayToolHost = {
                inspectTool: async () => tool,
                callTool: async (server, name, input, signal, context) => {
                    toolCalls++;
                    if (realReplay)
                        return realReplay.callTool(
                            server,
                            name,
                            input,
                            signal,
                            context,
                        );
                    return {
                        content: `fresh:${JSON.stringify(input)}:${toolCalls}`,
                    };
                },
            };
            const manager = new MacroManager(directory, replay);
            if (realTools) await configureCheckpointAPrograms(manager, replay);
            else
                manager.configureProgramRuntime({
                    execute: (artifact, input, context) =>
                        executeRecipeProgram(
                            artifact,
                            input,
                            {
                                runId: context.runId,
                                signal: context.signal,
                                binding: {
                                    workspaceId: directory,
                                    profileId: "typeagent",
                                    providerId: "typeagent",
                                    accountId: "test",
                                    sessionId: context.runId,
                                    generation: context.runId,
                                },
                                host: createTypeAgentRecipeHost(
                                    artifact,
                                    replay,
                                    directory,
                                    {
                                        id: "synthetic-model",
                                        approval: {
                                            capabilityId:
                                                "synthetic-completion",
                                            policyRevision: "1",
                                        },
                                        evidenceKind: "synthetic",
                                        async complete(request) {
                                            modelCalls++;
                                            return {
                                                kind: "json",
                                                text: JSON.stringify(
                                                    `classified:${JSON.stringify(request.input)}`,
                                                ),
                                                resolvedModel:
                                                    "synthetic-classifier",
                                                inputTokens: 2,
                                                outputTokens: 3,
                                            };
                                        },
                                    },
                                ),
                            },
                            {
                                timeoutMs: context.timeoutMs,
                                onCheckpoint: context.onCheckpoint,
                            },
                        ),
                });
            await manager.setMacroLearningPreference({
                cwd: directory,
                mode: "all",
            });
            const learner: MacroLearningRuntime = {
                extract: async (trace, traceId) => ({
                    schemaVersion: 1,
                    traceId,
                    request: trace.prompt,
                    toolCallIds: ["source"],
                    description: "Read current document",
                    uncertainties: [],
                }),
                build: async (_recipe, trace, baseline) => ({
                    name: "Current document",
                    description: "Read current document",
                    inputs: baseline.inputs,
                    steps: baseline.steps,
                    exampleInputs: { step_1_path: "alpha.txt" },
                    requests: [
                        trace.prompt,
                        "show file alpha.txt now",
                        "display file alpha.txt now",
                        "open file alpha.txt now",
                    ],
                }),
                generateGrammar: async (macro) => [
                    `<Start> = (read | show | display) file $(step_1_path:string) now -> { actionName: "${getMacroActionName(macro)}", parameters: { step_1_path } };`,
                ],
                validateGrammar: () => {},
                buildProgram: async (macro) => program(macro, hybrid, tool),
            };
            await manager.configureLearning(learner);
            const prompt = "read file alpha.txt now";
            const token = manager.armRecording({ sessionId: "recording" });
            manager.claimRecording({
                sessionId: "recording",
                cwd: directory,
                promptHash: createHash("sha256").update(prompt).digest("hex"),
            });
            const recorded = realReplay
                ? await realReplay.callTool(
                      "documents",
                      tool.toolName,
                      { path: "alpha.txt" },
                      new AbortController().signal,
                      { cwd: directory },
                  )
                : { content: "captured-alpha" };
            expect(recorded).toEqual({ content: "captured-alpha" });
            const trace = await manager.finalizeRecording({
                tokenId: token.id,
                trace: {
                    schemaVersion: 1,
                    sessionId: "recording",
                    cwd: directory,
                    prompt,
                    response: "Captured alpha output",
                    startedAt: "2026-10-15T20:00:00Z",
                    completedAt: "2026-10-15T20:00:01Z",
                    toolCalls: [
                        {
                            toolCallId: "source",
                            name: tool.toolName,
                            mcpServerName: "documents",
                            arguments: { path: "alpha.txt" },
                            result: recorded,
                            status: "completed",
                        },
                    ],
                },
            });
            let job = await manager.prepareMacroLearning({
                traceId: trace.traceId,
            });
            for (let attempt = 0; attempt < 1_000; attempt++) {
                job = await manager.getMacroLearningJob(job.jobId);
                if (!["queued", "extracting", "building"].includes(job.status))
                    break;
                await new Promise((resolve) => setTimeout(resolve, 5));
            }
            if (job.status !== "ready")
                throw new Error(
                    `Program learning failed: ${job.error ?? job.status}`,
                );
            expect(toolCalls).toBe(0);
            expect(modelCalls).toBe(0);
            const provider = createMacroAppAgentProvider(manager);
            const agent = await provider.loadAppAgent("macros");
            const dynamic = await agent.getDynamicGrammar!(
                {} as ActionContext["sessionContext"],
                "macros",
            );
            if (!dynamic || dynamic.format !== "agr")
                throw new Error("Grammar unavailable.");
            const grammar = loadGrammarRules("macros.agr", dynamic.content);
            const matched = matchGrammar(grammar, "read file beta.txt now");
            expect(matched).toHaveLength(1);
            const action = matched[0].match as Omit<AppAction, "schemaName">;
            const result = await agent.executeAction!(
                { ...action, schemaName: "macros" },
                { sessionContext: {} } as ActionContext,
            );
            expect(result).toBeDefined();
            expect(result).not.toHaveProperty("agentHandoff");
            expect(result).toHaveProperty(
                "resultValue",
                hybrid
                    ? 'classified:{"text":"fresh:{\\"path\\":\\"beta.txt\\"}:1"}'
                    : 'fresh:{"path":"beta.txt"}:1',
            );
            const response = await manager.runMacro({
                ...job.macro!,
                runId: "explicit",
                inputs: { step_1_path: "gamma.txt" },
            });
            expect(response.status).toBe("completed");
            if (response.status !== "completed")
                throw new Error("Program failed.");
            expect(response.run.result).toBe(
                hybrid
                    ? 'classified:{"text":"fresh:{\\"path\\":\\"gamma.txt\\"}:2"}'
                    : 'fresh:{"path":"gamma.txt"}:2',
            );
            expect(response.run.program?.fallback).toBe("never");
            expect(toolCalls).toBe(2);
            expect(modelCalls).toBe(hybrid ? 2 : 0);
            expect(response.run.program?.semanticEvidence).toHaveLength(
                hybrid ? 1 : 0,
            );
        },
    );
});
