// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CopilotSession } from "@github/copilot-sdk";
import { createMacroLearningRuntime } from "@typeagent/copilot-macros/macroAuthoringRuntime";
import { createMacroProgramAuthor } from "@typeagent/copilot-macros/macroProgramAuthoring";
import { RecipeExecutor } from "@typeagent/copilot-macros/recipeExecutor";
import { RecipeSemanticAdapter } from "@typeagent/copilot-macros/recipeSemantic";
import {
    getRecipeInferenceCliPath,
    getRecipeReadOnlyMcpTools,
} from "../shared/plugin-config.js";
import { localRecipeScope } from "../shared/recipe-local-paths.js";
import { isCopilotTelemetryTool } from "../shared/tool-identities.js";
import { createLocalRecipeService } from "./local-recipe-service.js";
import {
    captureNativeRecipeBinding,
    createNativeRecipeCapabilityInspector,
    sameNativeRecipeBinding,
} from "./recipe-native-host.js";
import {
    createStandaloneNativeRecipeModels,
    nativeRecipeModelPolicy,
} from "./recipe-native-model.js";
import {
    createNativeTypeAgentRecipeHost,
    createTypeAgentRecordingNormalizer,
} from "./recipe-typeagent-host.js";
import { createNativeTypeAgentInteraction } from "./recipe-typeagent-interaction.js";

export async function createPluginLocalRecipes(
    session: CopilotSession,
    report: (message: string) => void,
) {
    const cwd = process.cwd();
    const scope = localRecipeScope(cwd);
    const binding = await captureNativeRecipeBinding(session, scope.profileId);
    if (binding.workspaceId !== scope.workspaceId)
        throw new Error(
            "The joined native session belongs to another workspace.",
        );
    const policy = { readOnlyMcpTools: getRecipeReadOnlyMcpTools() };
    const recording = createTypeAgentRecordingNormalizer();
    const currentBinding = async () => {
        const current = await captureNativeRecipeBinding(
            session,
            scope.profileId,
        );
        if (
            !sameNativeRecipeBinding(
                { ...binding, generation: current.generation },
                current,
            )
        )
            throw new Error(
                "The local recipe workspace/account/session changed; reload the owner.",
            );
        return current;
    };
    const inspect = async (
        step: Parameters<
            ReturnType<typeof createNativeRecipeCapabilityInspector>
        >[0],
    ) => {
        const bridge = createNativeTypeAgentRecipeHost(
            session,
            await currentBinding(),
            {
                invokeSemantic: async () => ({
                    status: "unsupported",
                    message: "Discovery cannot invoke models.",
                }),
            },
            policy,
        );
        try {
            return await bridge.inspectTool(step);
        } finally {
            await bridge.dispose();
        }
    };
    const cliPath = getRecipeInferenceCliPath();
    const models = await createStandaloneNativeRecipeModels(
        session,
        binding,
        cliPath === undefined ? {} : { cliPath },
    );
    const sourceQuery = async (): Promise<string> => {
        throw new Error(
            "Program authorship requires a sealed Copilot child request; no default planner fallback is allowed.",
        );
    };
    const buildProgram = createMacroProgramAuthor({
        query: sourceQuery,
        verifierQuery: models.query,
        semanticModelPolicy: nativeRecipeModelPolicy,
        inspectCapability: async (step, _cwd, signal) => {
            signal.throwIfAborted();
            const result = await inspect(step);
            if (result.status !== "available") throw new Error(result.message);
            return result.capability;
        },
    });
    const executor = new RecipeExecutor();
    try {
        const local = await createLocalRecipeService({
            cwd,
            sessionId: session.sessionId,
            report,
            replayHost: {
                supportsNativeTools: true,
                inspectTool: async (mcpServerName, toolName) => {
                    const result = await inspect({
                        toolName,
                        ...(mcpServerName ? { mcpServerName } : {}),
                    });
                    if (result.status !== "available")
                        throw new Error(result.message);
                    const capability = result.capability;
                    return {
                        toolName,
                        ...(mcpServerName ? { mcpServerName } : {}),
                        schemaFingerprint: capability.schemaDigest,
                        readOnly: capability.effect === "read",
                        inputSchema: capability.inputSchema,
                        ...(capability.outputSchema
                            ? { outputSchema: capability.outputSchema }
                            : {}),
                    };
                },
                callTool: async () => {
                    throw new Error(
                        "Recording authoring cannot execute task tools.",
                    );
                },
            },
            learning: (loadApproved) =>
                createMacroLearningRuntime(
                    sourceQuery,
                    loadApproved,
                    undefined,
                    buildProgram,
                ),
            program: {
                execute: async (artifact, input, context) => {
                    const executionBinding = await currentBinding();
                    const semantics = new Map(
                        artifact.semanticFunctions.map((definition) => [
                            definition.id,
                            new RecipeSemanticAdapter(
                                { definition },
                                models.provider,
                            ),
                        ]),
                    );
                    const bridge = createNativeTypeAgentRecipeHost(
                        session,
                        executionBinding,
                        {
                            invokeSemantic: async (definition, value, call) => {
                                const adapter = semantics.get(definition.id);
                                if (!adapter)
                                    return {
                                        status: "unsupported",
                                        code: "undeclared_semantic",
                                        message:
                                            "This program did not declare the semantic function.",
                                    };
                                return adapter.invokeSemantic(
                                    definition,
                                    value,
                                    call,
                                );
                            },
                        },
                        policy,
                        createNativeTypeAgentInteraction(
                            session,
                            executionBinding,
                        ),
                    );
                    try {
                        return await executor.execute(
                            artifact,
                            input,
                            {
                                runId: context.runId,
                                signal: context.signal,
                                binding: executionBinding,
                                host: bridge.host,
                            },
                            {
                                timeoutMs: context.timeoutMs,
                                onCheckpoint: context.onCheckpoint,
                            },
                        );
                    } finally {
                        await bridge.dispose();
                    }
                },
            },
        });
        let closing: Promise<void> | undefined;
        return {
            ...local,
            normalizeToolResult: recording.normalizeToolResult,
            prepareTrace: recording.prepareTrace,
            async resolveToolIdentity(
                toolName: string,
                mcpServerName?: string,
            ) {
                if (isCopilotTelemetryTool(toolName, mcpServerName))
                    return {
                        toolName,
                        ...(mcpServerName ? { mcpServerName } : {}),
                    };
                await currentBinding();
                const { tools } = await session.rpc.tools.getCurrentMetadata();
                const matches = (tools ?? []).filter(
                    (tool) =>
                        (!mcpServerName ||
                            tool.mcpServerName === mcpServerName) &&
                        (tool.name === toolName ||
                            (mcpServerName && tool.mcpToolName === toolName)),
                );
                if (matches.length !== 1)
                    throw new Error(
                        "The recorded tool identity is unavailable or ambiguous in the native registry.",
                    );
                const tool = matches[0];
                if (tool.mcpServerName && !tool.mcpToolName)
                    throw new Error(
                        "The native registry did not expose the MCP tool identity.",
                    );
                return {
                    toolName: tool.mcpToolName ?? tool.name,
                    ...(tool.mcpServerName
                        ? { mcpServerName: tool.mcpServerName }
                        : {}),
                };
            },
            close() {
                closing ??= (async () => {
                    try {
                        await local.close();
                    } finally {
                        recording.clear();
                        await Promise.all([executor.close(), models.dispose()]);
                    }
                })();
                return closing;
            },
        };
    } catch (error) {
        await Promise.all([executor.close(), models.dispose()]);
        throw error;
    }
}
