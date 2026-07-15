// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommonApiSettings, ModelType } from "./openai.js";
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
};

// claude-haiku-4.5 is a fast, non-reasoning model. It is the effective default
// for Copilot provider mode because simple translation calls don't benefit from
// model-side "thinking" and pay a large latency penalty for it. If a tenant
// doesn't expose this model, the adapter falls back to "auto" at request time.
// Users can still opt into any model via `copilot.defaultModel` in the config.
const DEFAULT_MODEL = "claude-haiku-4.5";

// Fallback used when the configured/default model is not available in the
// current Copilot tenant (client.listModels() doesn't list it). "auto" is
// always present and lets the CLI pick an available model.
export const COPILOT_FALLBACK_MODEL = "auto";

export function copilotApiSettingsFromConfig(
    modelName?: string,
): CopilotApiSettings {
    const config = getRuntimeConfig();
    const copilot = config.copilot;
    const resolvedModel = modelName ?? copilot?.defaultModel ?? DEFAULT_MODEL;
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
        maxConcurrency: copilot?.maxConcurrency,
        timeout: copilot?.maxTimeoutMs ?? 120_000,
        maxRetryAttempts: copilot?.maxRetryAttempts ?? 1,
        enableModelRequestLogging: copilot?.enableModelRequestLogging,
    };
}
