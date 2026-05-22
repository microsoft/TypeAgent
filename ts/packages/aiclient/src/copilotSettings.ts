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
    reasoningEffort?: CopilotReasoningEffort;
    disableInfiniteSessions: boolean;
};

const DEFAULT_MODEL = "claude-sonnet-4.5";

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
