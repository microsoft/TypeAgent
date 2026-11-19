// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { RequestBudget } from "@typeagent/aiclient";

export function configuredModelIdentity(settings: {
    provider: string;
    modelName?: string | undefined;
    endpoint: string;
}): string | null {
    if (settings.modelName?.trim()) return settings.modelName;
    if (settings.provider !== "azure") return null;
    const deployment = new URL(settings.endpoint).pathname.match(
        /\/openai\/deployments\/([^/]+)(?:\/|$)/,
    )?.[1];
    return deployment ? decodeURIComponent(deployment) : null;
}

export function assertCampaignRuntime(
    actual: {
        configurationIdentity: string;
        configurationHash: string;
        providerSettingsHash: string;
        nodeVersion: string;
        providers: (string | null)[];
        models: (string | null)[];
    },
    expected: unknown,
) {
    if (!expected || typeof expected !== "object")
        throw new Error("Frozen arm runtime required");
    const frozen = expected as Record<string, unknown>;
    if (
        [
            "configurationIdentity",
            "configurationHash",
            "providerSettingsHash",
            "nodeVersion",
        ].some((key) => frozen[key] === undefined)
    )
        throw new Error("Incomplete frozen runtime");
    if (
        actual.configurationIdentity !== frozen.configurationIdentity ||
        actual.configurationHash !== frozen.configurationHash ||
        actual.providerSettingsHash !== frozen.providerSettingsHash ||
        actual.nodeVersion !== frozen.nodeVersion ||
        !actual.providers.length ||
        !actual.models.length ||
        actual.providers.some(
            (provider) => provider === null || provider !== frozen.provider,
        ) ||
        actual.models.some((model) => model === null || model !== frozen.model)
    )
        throw new Error(
            "Configured runtime differs from frozen arm; no dispatch authorized",
        );
}

export function parseCampaignBudget(value: unknown) {
    if (!value || typeof value !== "object")
        throw new Error("Campaign request budget required");
    const input = value as Record<string, unknown>;
    const integer = (key: string) => {
        const number = input[key];
        if (
            typeof number !== "number" ||
            !Number.isSafeInteger(number) ||
            number < 1
        )
            throw new Error(
                `Campaign budget.${key}: positive integer required`,
            );
        return number;
    };
    if (input.tokenizer !== "utf8-bytes-v1")
        throw new Error(
            "Campaign requires the named conservative utf8-bytes-v1 estimator",
        );
    const calls = integer("calls");
    const reservedTokens = integer("reservedTokens");
    const cost = input.cost;
    const maxCostPerCall = input.maxCostPerCall;
    if (
        typeof cost !== "number" ||
        !Number.isFinite(cost) ||
        cost <= 0 ||
        typeof maxCostPerCall !== "number" ||
        !Number.isFinite(maxCostPerCall) ||
        maxCostPerCall <= 0
    )
        throw new Error(
            "Positive cost reservation and approved per-call upper bound required",
        );
    return {
        budget: new RequestBudget({
            inputTokens: integer("inputTokens"),
            outputTokens: integer("outputTokens"),
            safetyTokens: integer("safetyTokens"),
            chatAttempts: calls,
            embeddingAttempts: calls,
            reservedTokens,
            elapsedMs: integer("elapsedMs"),
            tokenizer: input.tokenizer,
            countTokens: (serialized) => Buffer.byteLength(serialized, "utf8"),
        }),
        captureLimits: { calls, reservedTokens, cost, maxCostPerCall },
    };
}
