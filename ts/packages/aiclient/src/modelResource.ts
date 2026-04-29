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

// Tail tokens that represent region / PTU variants rather than distinct
// models. When enumerating model names for the UI, a key like
// AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS should surface as "GPT_4_O", not
// "GPT_4_O_EASTUS" — otherwise every regional variant pollutes the model
// picker with a bogus "model".
const REGION_TAIL_TOKENS = new Set([
    "EASTUS",
    "EASTUS2",
    "WESTUS",
    "WESTUS2",
    "WESTUS3",
    "CENTRALUS",
    "NORTHCENTRALUS",
    "SOUTHCENTRALUS",
    "WESTCENTRALUS",
    "SWEDEN",
    "SWEDENCENTRAL",
    "FRANCECENTRAL",
    "GERMANYWESTCENTRAL",
    "NORWAYEAST",
    "NORTHEUROPE",
    "WESTEUROPE",
    "UKSOUTH",
    "UKWEST",
    "SWITZERLANDNORTH",
    "JAPANEAST",
    "JAPANWEST",
    "AUSTRALIAEAST",
    "KOREACENTRAL",
    "SOUTHEASTASIA",
    "EASTASIA",
    "CENTRALINDIA",
    "SOUTHINDIA",
    "BRAZILSOUTH",
    "CANADACENTRAL",
    "CANADAEAST",
    "JAPAN",
    "AUSTRALIA",
    "BRAZIL",
    "CANADA",
    "KOREA",
    "UK",
    "PTU",
]);

function stripRegionTail(suffix: string): string {
    // Strip a trailing _PTU and a trailing _<REGION>. We only strip when the
    // trailing token matches a known region token — otherwise we'd collapse
    // genuinely distinct model suffixes.
    const parts = suffix.split("_");
    while (parts.length > 1) {
        const last = parts[parts.length - 1];
        if (REGION_TAIL_TOKENS.has(last)) {
            parts.pop();
        } else {
            break;
        }
    }
    // Also handle multi-token regions that collide when split by "_", e.g.
    // SWEDEN_CENTRAL, NORTH_CENTRAL_US. Rejoin the remaining tail tokens and
    // check if the concatenation is a known region.
    while (parts.length > 1) {
        const joined = parts.slice(-2).join("");
        if (REGION_TAIL_TOKENS.has(joined)) {
            parts.splice(-2, 2);
            continue;
        }
        const joined3 =
            parts.length >= 3 ? parts.slice(-3).join("") : undefined;
        if (joined3 && REGION_TAIL_TOKENS.has(joined3)) {
            parts.splice(-3, 3);
            continue;
        }
        break;
    }
    return parts.join("_");
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
            .map((key) => key.replace(prefix, ""))
            .map(stripRegionTail)
            .filter((name) => name.length > 0);
    };
    const azureNames = [
        ...new Set(getPrefixedNames(ai.EnvVars.AZURE_OPENAI_API_KEY)),
    ];
    const openaiNames = [
        ...new Set(getPrefixedNames(ai.EnvVars.OPENAI_API_KEY)),
    ].map((key) => `openai:${key}`);

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
