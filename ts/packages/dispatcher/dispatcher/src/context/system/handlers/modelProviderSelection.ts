// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DefaultCopilotEmbeddingModel,
    getRuntimeConfig,
    setRuntimeConfig,
    type ProviderMode,
} from "@typeagent/aiclient";
import type { CommandHandlerContext } from "../../commandHandlerContext.js";

export async function applyModelProviderSelection(
    name: ProviderMode,
    systemContext: Pick<CommandHandlerContext, "agents" | "translatorCache">,
): Promise<void> {
    process.env.TYPEAGENT_MODEL_PROVIDER = name;

    const currentConfig = getRuntimeConfig();
    if (name === "copilot") {
        process.env.TYPEAGENT_EMBEDDING_PROVIDER = "copilot";
        process.env.TYPEAGENT_EMBEDDING_MODEL = DefaultCopilotEmbeddingModel;
        setRuntimeConfig({
            ...currentConfig,
            modelProvider: name,
            embedding: {
                ...currentConfig.embedding,
                provider: "copilot",
                model: DefaultCopilotEmbeddingModel,
            },
        });
        await systemContext.agents.rebuildActionSemanticMap();
    } else {
        setRuntimeConfig({ ...currentConfig, modelProvider: name });
    }

    systemContext.translatorCache.clear();
}
