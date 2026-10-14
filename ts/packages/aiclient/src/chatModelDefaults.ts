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
    if (
        settings.modelType !== ModelType.Chat ||
        settings.requestConstraints !== undefined ||
        (settings.provider !== "azure" && settings.provider !== "openai")
    )
        return;
    const model =
        settings.modelName ??
        /\/deployments\/([^/]+)\//i.exec(settings.endpoint)?.[1];
    if (model?.toLowerCase() === DEFAULT_OPENAI_CHAT_MODEL)
        settings.requestConstraints = LUNA_REQUEST_CONSTRAINTS;
}
