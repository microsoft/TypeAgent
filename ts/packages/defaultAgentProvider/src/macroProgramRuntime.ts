// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    type MacroLearningRuntime,
    type MacroManager,
    type ReplayToolHost,
} from "@typeagent/copilot-macros";
import path from "node:path";
import {
    createRecipeCapabilityInspector,
    createTypeAgentRecipeHost,
} from "./recipeToolHost.js";

export async function configureCheckpointAPrograms(
    manager: MacroManager,
    replayHost: ReplayToolHost,
): Promise<NonNullable<MacroLearningRuntime["buildProgram"]>> {
    const [
        { executeRecipeProgram },
        { createMacroProgramAuthor },
        { createTypeAgentRecipeSemanticProvider },
    ] = await Promise.all([
        import("@typeagent/copilot-macros/recipeExecutor"),
        import("./macroProgramAuthoring.js"),
        import("./recipeModelProvider.js"),
    ]);
    const selected = process.env.TYPEAGENT_MACRO_LEARNING_MODEL?.trim();
    const provider = createTypeAgentRecipeSemanticProvider({
        id: "typeagent-configured-model",
        approval: {
            capabilityId: "typeagent:completion",
            policyRevision: "1",
        },
        modelPolicies: [
            {
                id: "typeagent-default",
                revision: "1",
                model: selected ? `copilot:${selected}` : "copilot",
            },
        ],
    });
    manager.configureProgramRuntime({
        async execute(artifact, input, context) {
            if (!context.cwd.trim())
                throw new Error(
                    "Program execution requires its recorded workspace.",
                );
            if (
                artifact.capabilities.some(
                    (capability) => capability.effect !== "read",
                )
            )
                throw new Error(
                    "Checkpoint A effectful program execution is not enabled.",
                );
            const host = createTypeAgentRecipeHost(
                artifact,
                replayHost,
                context.cwd,
                provider,
            );
            return executeRecipeProgram(
                artifact,
                input,
                {
                    runId: context.runId,
                    signal: context.signal,
                    host,
                    binding: {
                        workspaceId: path.resolve(context.cwd),
                        profileId: "typeagent",
                        providerId: "typeagent",
                        accountId: "live-host",
                        sessionId: context.runId,
                        generation: context.runId,
                    },
                },
                {
                    timeoutMs: context.timeoutMs,
                    onCheckpoint: context.onCheckpoint,
                },
            );
        },
    });
    return createMacroProgramAuthor({
        inspectCapability: createRecipeCapabilityInspector(replayHost),
    });
}
