// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ModelType } from "./apiTypes.js";
import {
    DEFAULT_COPILOT_FALLBACK_MODELS,
    DEFAULT_COPILOT_MODEL,
} from "./copilotModelDefaults.js";
import type { CommonApiSettings } from "./openai.js";
import { getRuntimeConfig } from "./runtimeConfig.js";

export type CopilotReasoningEffort = "low" | "medium" | "high" | "xhigh";

export type CopilotApiSettings = CommonApiSettings & {
    provider: "copilot";
    modelType: ModelType.Chat;
    modelName: string;
    cliPath?: string;
    cliUrl?: string;
    reasoningEffort?: CopilotReasoningEffort;
    disableInfiniteSessions: boolean;
    fallbackModels: readonly string[];
};

// Environment gate the SDK requires before `provider.getEndpoint` will return a
// direct-CAPI endpoint. It must be set before the Copilot CLI child process is
// spawned (the child inherits it and enforces the gate). We set it here — the
// earliest shared resolution point — so it's on before any client is created.
// The Copilot provider uses the direct-CAPI transport exclusively.
const ENDPOINT_GATE_ENV = "COPILOT_ALLOW_GET_PROVIDER_ENDPOINT";

export function copilotApiSettingsFromConfig(
    modelName?: string,
): CopilotApiSettings {
    const config = getRuntimeConfig();
    const copilot = config.copilot;
    const resolvedModel =
        modelName ?? copilot?.defaultModel ?? DEFAULT_COPILOT_MODEL;
    if (!process.env[ENDPOINT_GATE_ENV]) {
        process.env[ENDPOINT_GATE_ENV] = "true";
    }
    return {
        provider: "copilot",
        modelType: ModelType.Chat,
        endpoint: "copilot-cli",
        modelName: resolvedModel,
        ...(copilot?.cliPath !== undefined ? { cliPath: copilot.cliPath } : {}),
        ...(copilot?.cliUrl !== undefined ? { cliUrl: copilot.cliUrl } : {}),
        ...(copilot?.reasoningEffort !== undefined
            ? { reasoningEffort: copilot.reasoningEffort }
            : {}),
        disableInfiniteSessions: copilot?.disableInfiniteSessions ?? true,
        fallbackModels:
            copilot?.fallbackModels ?? DEFAULT_COPILOT_FALLBACK_MODELS,
        maxConcurrency: copilot?.maxConcurrency,
        timeout: copilot?.maxTimeoutMs ?? 120_000,
        maxRetryAttempts: copilot?.maxRetryAttempts ?? 1,
        enableModelRequestLogging: copilot?.enableModelRequestLogging,
    };
}
