// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    buildCopilotDecisionRequest as buildNativeCopilotDecisionRequest,
    createDecisionModel,
    normalizeDecisionAnswers,
} from "@typeagent/aiclient";

export const decisionProviderOptions = {
    provider: { type: "string", default: "copilot" },
    "config-key": { type: "string", default: "decision_1" },
    region: { type: "string" },
    model: { type: "string" },
};

export function requestedDecisionModel(values = {}) {
    return (
        values.model ??
        (values.provider === "azure"
            ? process.env.AZURE_DECISION_DEPLOYMENT
            : "gpt-6-luna-decisions")
    );
}

export function createVariantDecisionClient(
    config,
    values = {},
    endpointProvider,
) {
    const provider = values.provider ?? "copilot";
    if (!["copilot", "azure"].includes(provider))
        throw new Error("--provider must be copilot or azure.");
    if (provider === "copilot") {
        if (values.region) throw new Error("--region applies only to Azure.");
        return createCopilotDecisionClient(
            config,
            { model: values.model, cliPath: values["cli-path"] },
            endpointProvider,
        );
    }
    if (values["cli-path"])
        throw new Error("--cli-path applies only to Copilot decisions.");
    const deployment = requestedDecisionModel(values);
    if (!deployment?.trim())
        throw new Error(
            "Azure decisions require --model <deployment name> or AZURE_DECISION_DEPLOYMENT.",
        );
    return createDecisionClient(
        config,
        values["config-key"] ?? "decision_1",
        deployment,
        values.region,
    );
}

export function createCopilotDecisionClient(
    config,
    { model = "gpt-6-luna-decisions", cliPath } = {},
    endpointProvider,
) {
    if (!model.trim()) throw new Error("Model name must not be empty.");
    const { cliUrl: _cliUrl, ...copilot } = config.copilot ?? {};
    const effective = {
        ...config,
        copilot: cliPath ? { ...copilot, cliPath } : config.copilot,
        decision: {
            ...config.decision,
            copilot: { ...config.decision?.copilot, model },
        },
    };
    return exampleClient(
        effective,
        "copilot",
        [{ model, path: "/v1/decisions", authentication: "copilot" }],
        endpointProvider,
    );
}

export function buildCopilotDecisionRequest(model, state, questions) {
    return buildNativeCopilotDecisionRequest(model, { state, questions });
}

export function normalizeCopilotAnswers(payload, questions) {
    const normalized = normalizeDecisionAnswers(payload, questions, "copilot");
    const answers = Object.fromEntries(
        Object.entries(normalized).map(([name, answer]) => [
            name,
            {
                ...payload.answers.find((native) => native.name === name),
                ...answer,
            },
        ]),
    );
    return { ...payload, answers, nativeAnswers: payload.answers };
}

export function createDecisionClient(config, configKey, model, region) {
    if (!config.azureOpenAI.deployments.has(configKey)) {
        throw new Error(`No deployment configured under '${configKey}'.`);
    }
    if (!model.trim()) throw new Error("Deployment name must not be empty.");
    const deployment = config.azureOpenAI.deployments.get(configKey);
    const endpoints = deployment.endpoints.filter(
        (endpoint) => !region || endpoint.region === region,
    );
    if (!endpoints.length) throw new Error("No endpoints match the region.");
    const deployments = new Map(config.azureOpenAI.deployments);
    deployments.set(configKey, { ...deployment, endpoints });
    const effective = {
        ...config,
        azureOpenAI: { ...config.azureOpenAI, deployments },
        decision: {
            ...config.decision,
            azure: { deploymentKey: configKey, deploymentName: model },
        },
    };
    return exampleClient(
        effective,
        "azure",
        endpoints.map((endpoint) => ({
            region: endpoint.region,
            endpoint: endpoint.endpoint,
            authentication:
                (endpoint.auth ?? config.azureOpenAI.auth) === "identity"
                    ? "identity"
                    : "api-key",
        })),
    );
}

export function validateAnswers(payload, questions) {
    normalizeDecisionAnswers(payload, questions, "azure");
    return payload;
}

function exampleClient(config, provider, endpoints, endpointProvider) {
    const created = createDecisionModel({ config, provider, endpointProvider });
    if (!created.success) throw new Error(created.message);
    return {
        endpoints,
        async decide(state, questions) {
            const result = await created.data.decide(
                { state, questions },
                { timeoutMs: 60_000 },
            );
            if (!result.success) throw new Error(result.message);
            return { ...result.data, model: result.data.reportedModel };
        },
    };
}

export function median(values) {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}
