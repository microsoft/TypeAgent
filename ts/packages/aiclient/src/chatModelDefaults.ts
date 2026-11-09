// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ModelRequestConstraints } from "@typeagent/config";
import { ModelType } from "./apiTypes.js";
import type { ApiSettings } from "./openai.js";

export const DEFAULT_AZURE_CHAT_DEPLOYMENT = "GPT_6_LUNA";
export const DEFAULT_OPENAI_CHAT_MODEL = "gpt-6-luna";

// https://developers.openai.com/api/docs/models/gpt-6-luna
const LUNA_REQUEST_CONSTRAINTS: ModelRequestConstraints = Object.freeze({
    contextTokens: 1_050_000,
    inputTokens: 922_000,
    outputTokens: 128_000,
});

export function applyChatModelRequestDefaults(settings: ApiSettings): void {
    if (settings.requestConstraints !== undefined || !isLunaChatModel(settings))
        return;
    settings.requestConstraints = LUNA_REQUEST_CONSTRAINTS;
}

function getOpenAIChatModelIdentifier(
    settings: ApiSettings,
): string | undefined {
    if (
        settings.modelType !== ModelType.Chat ||
        (settings.provider !== "azure" && settings.provider !== "openai")
    )
        return undefined;
    return (
        settings.modelName ??
        /\/deployments\/([^/]+)\//i.exec(settings.endpoint)?.[1]
    );
}

export function isLunaChatModel(settings: ApiSettings): boolean {
    return (
        getOpenAIChatModelIdentifier(settings)?.toLowerCase() ===
        DEFAULT_OPENAI_CHAT_MODEL
    );
}

export function isGpt4ChatModel(settings: ApiSettings): boolean {
    const model = getOpenAIChatModelIdentifier(settings);
    return model !== undefined && /^gpt[-_.]?4(?:o|$|[-_.])/i.test(model);
}
