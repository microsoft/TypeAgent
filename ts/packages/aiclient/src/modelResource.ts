// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai as ai } from "aiclient";
import { getOllamaModelNames } from "./ollamaModels.js";

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

export async function getChatModelNames() {
    const envKeys = Object.keys(process.env);
    const knownEnvKeys = Object.keys(ai.EnvVars);

    const getPrefixedNames = (name: string) => {
        const prefix = `${name}_`;
        return envKeys
            .filter(
                (key) =>
                    key.startsWith(prefix) &&
                    knownEnvKeys.every(
                        (knownKey) =>
                            knownKey === name || !key.startsWith(knownKey),
                    ),
            )
            .map((key) => key.replace(prefix, ""));
    };
    const azureNames = getPrefixedNames(ai.EnvVars.AZURE_OPENAI_API_KEY);
    const openaiNames = getPrefixedNames(ai.EnvVars.OPENAI_API_KEY).map(
        (key) => `openai:${key}`,
    );

    return [...azureNames, ...openaiNames, ...(await getOllamaModelNames())];
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
