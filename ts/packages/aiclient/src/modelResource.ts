// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai as ai } from "aiclient";
import { getOllamaModelNames } from "./ollamaModels.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { getCopilotClient } from "./copilotModels.js";
import registerDebug from "debug";

const debugModelResource = registerDebug("typeagent:aiclient:modelresource");

let copilotModelNamesCache: string[] | undefined;
async function getCopilotModelNames(): Promise<string[]> {
    if (copilotModelNamesCache !== undefined) return copilotModelNamesCache;
    const config = getRuntimeConfig();
    if (config.copilot === undefined) {
        copilotModelNamesCache = [];
        return copilotModelNamesCache;
    }
    try {
        const client = await getCopilotClient(config.copilot.cliPath);
        const models = await client.listModels();
        copilotModelNamesCache = models
            .filter((m) => m.policy?.state !== "disabled")
            .map((m) => `copilot:${m.id}`);
    } catch (err) {
        debugModelResource(
            "Failed to list Copilot models: %s",
            err instanceof Error ? err.message : String(err),
        );
        copilotModelNamesCache = [];
    }
    return copilotModelNamesCache;
}

export function getChatModelMaxConcurrency(
    userMaxConcurrency?: number,
    endpoint?: string,
    defaultConcurrency = 1,
) {
    const maxConcurrency = ai.getChatModelSettings(endpoint).maxConcurrency;
    if (userMaxConcurrency === undefined) {
        return maxConcurrency ?? defaultConcurrency;
    }
    if (userMaxConcurrency <= 0) {
        return defaultConcurrency;
    }
    return maxConcurrency !== undefined
        ? Math.min(userMaxConcurrency, maxConcurrency)
        : userMaxConcurrency;
}

// Tail tokens that represent region / PTU variants rather than distinct
// models. (Previously used to strip suffixes from env-var-derived names.
// The typed Config now keys deployments by canonical name, so no stripping
// is needed.)

export async function getChatModelNames() {
    // Azure deployment names come from the typed Config. The typed
    // map keys deployments by name directly — no need to scan env-var
    // prefixes and strip region tails. Names are uppercased to match
    // the legacy env-suffix convention that consumers expect.
    const config = getRuntimeConfig();
    const azureNames = [...config.azureOpenAI.deployments.keys()].map((n) =>
        n.toUpperCase(),
    );

    // OpenAI named variants come from the typed `OpenAIConfig`. The
    // only named variant currently modeled is `openAI.local`, which
    // surfaces as `openai:LOCAL`.
    const openaiNames: string[] = [];
    if (config.openAI?.local !== undefined) {
        openaiNames.push("openai:LOCAL");
    }

    return [
        ...azureNames,
        ...openaiNames,
        ...(await getOllamaModelNames()),
        ...(await getCopilotModelNames()),
    ];
}

export function isMultiModalContentSupported(modelName: string | undefined) {
    if (modelName === undefined) {
        return false;
    } else if (
        modelName.toUpperCase() == "GPT_4_O" ||
        modelName.toUpperCase() == "GPT_V"
    ) {
        return true;
    } else if (modelName == "") {
        // default model is now 4_O
        return true;
    }

    return false;
}
