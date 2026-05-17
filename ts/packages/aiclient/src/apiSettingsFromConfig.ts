// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Typed-config entry points for aiclient.
 *
 * These functions are the post-migration counterparts to
 * `apiSettingsFromEnv` and friends. They take a typed `Config`
 * (built once at startup from YAML / Vault / .env) and resolve
 * deployment + region without any string-suffix arithmetic.
 *
 * Phase B of the typed-config migration: these live alongside the
 * existing env-based functions; new callers should prefer these,
 * existing callers can migrate at their own pace. Internally the
 * env-based functions are now thin adapters that call into here
 * via `buildConfig(env)`, so behavior is unchanged for both paths.
 */

import {
    buildConfig,
    type AuthMode,
    type Config,
    type Deployment,
    type DeploymentEndpoint,
    type Region,
} from "@typeagent/config";

import {
    AuthTokenProvider,
    AzureTokenScopes,
    createAzureTokenProvider,
} from "./auth.js";
import type { AzureApiSettings } from "./azureSettings.js";
import { ApiSettings, ModelType } from "./openai.js";
import type { OpenAIApiSettings } from "./openaiSettings.js";

const azureTokenProvider = createAzureTokenProvider(
    AzureTokenScopes.CogServices,
);

function authToken(auth: AuthMode): {
    apiKey: string;
    tokenProvider?: AuthTokenProvider;
} {
    if (auth.kind === "identity") {
        return { apiKey: "identity", tokenProvider: azureTokenProvider };
    }
    return { apiKey: auth.value };
}

/**
 * Pick the highest-capacity endpoint from a deployment, falling back
 * to the first endpoint when no entry has an explicit capacity. Used
 * to auto-select a default embedding deployment when the config does
 * not declare `azureOpenAI.defaultEmbedding`.
 */
function pickHighestCapacityEndpoint(
    deployment: Deployment | undefined,
): DeploymentEndpoint | undefined {
    if (!deployment || deployment.endpoints.length === 0) return undefined;
    let best: DeploymentEndpoint | undefined;
    let bestCapacity = -Infinity;
    for (const ep of deployment.endpoints) {
        const cap = ep.capacity ?? 0;
        if (cap > bestCapacity) {
            best = ep;
            bestCapacity = cap;
        }
    }
    return best ?? deployment.endpoints[0];
}

/**
 * Look up a deployment's endpoint by name, optionally pinned to a
 * specific region. When `region` is omitted, returns the highest-
 * priority pool member (PTU before PAYG; insertion order otherwise).
 */
export function getDeploymentEndpoint(
    config: Config,
    deploymentName: string,
    region?: Region,
): DeploymentEndpoint | undefined {
    const dep = config.azureOpenAI.deployments.get(deploymentName);
    if (!dep) return undefined;
    if (region !== undefined) {
        return dep.endpoints.find((ep) => ep.region === region);
    }
    return dep.endpoints[0];
}

/**
 * Look up a deployment by name. Mirror of the legacy
 * `endpointName` parameter — the name is the lowercase form of
 * the env-var suffix (e.g. `"gpt_4_o"` for `GPT_4_O`).
 */
export function getDeployment(
    config: Config,
    deploymentName: string,
): Deployment | undefined {
    return config.azureOpenAI.deployments.get(deploymentName);
}

/**
 * Build `AzureApiSettings` from a typed `Config` for the named
 * deployment + model type. When `deploymentName` is omitted, falls
 * back to the bare/default endpoint for the given model type.
 *
 * Mirrors `azureApiSettingsFromEnv` exactly; identity auth gets the
 * shared Azure token provider attached.
 */
export function azureApiSettingsFromConfig(
    config: Config,
    modelType: ModelType,
    deploymentName?: string,
    region?: Region,
): AzureApiSettings {
    const ao = config.azureOpenAI;

    let endpoint: DeploymentEndpoint | undefined;
    if (deploymentName !== undefined) {
        endpoint = getDeploymentEndpoint(config, deploymentName, region);
    }

    if (endpoint === undefined) {
        // Service-default fallback paths.
        switch (modelType) {
            case ModelType.Chat:
                endpoint = ao.defaultChat;
                break;
            case ModelType.Embedding:
                endpoint =
                    ao.defaultEmbedding ??
                    pickHighestCapacityEndpoint(
                        ao.deployments.get("embedding"),
                    );
                break;
            case ModelType.Image:
                endpoint = ao.defaultImage;
                break;
            case ModelType.Video:
                endpoint = ao.defaultVideo;
                break;
        }
    }

    if (endpoint === undefined) {
        const where =
            deploymentName !== undefined
                ? `deployment '${deploymentName}'${region ? ` in region '${region}'` : ""}`
                : `default ${modelType}`;
        throw new Error(`No Azure OpenAI endpoint configured for ${where}`);
    }

    const auth = authToken(endpoint.auth);
    const settings: AzureApiSettings = {
        provider: "azure",
        modelType,
        apiKey: auth.apiKey,
        endpoint: endpoint.endpoint,
        supportsResponseFormat: ao.responseFormat,
        maxConcurrency: ao.maxConcurrency,
        timeout: ao.maxTimeoutMs,
        maxRetryAttempts: ao.maxRetryAttempts,
        ...(ao.maxPromptChars !== undefined
            ? { maxPromptChars: ao.maxPromptChars }
            : {}),
        ...(ao.enableModelRequestLogging
            ? { enableModelRequestLogging: true }
            : {}),
        ...(auth.tokenProvider ? { tokenProvider: auth.tokenProvider } : {}),
    };
    return settings;
}

/**
 * Build `OpenAIApiSettings` from a typed `Config`. Errors if
 * `config.openAI` is undefined.
 */
export function openAIApiSettingsFromConfig(
    config: Config,
    modelType: ModelType,
): OpenAIApiSettings {
    const oai = config.openAI;
    if (!oai) {
        throw new Error("No OpenAI configuration available");
    }
    const endpoint =
        modelType === ModelType.Chat ? oai.endpoint : oai.endpointEmbedding;
    if (!endpoint) {
        throw new Error(
            `No OpenAI endpoint configured for ${modelType === ModelType.Chat ? "chat" : "embedding"}`,
        );
    }
    const settings: OpenAIApiSettings = {
        provider: "openai",
        modelType,
        apiKey: oai.apiKey,
        endpoint,
        ...(modelType === ModelType.Chat
            ? oai.model !== undefined
                ? { modelName: oai.model }
                : {}
            : oai.modelEmbedding !== undefined
              ? { modelName: oai.modelEmbedding }
              : {}),
        ...(oai.organization !== undefined
            ? { organization: oai.organization }
            : {}),
        supportsResponseFormat: oai.responseFormat,
        maxConcurrency: oai.maxConcurrency,
        timeout: oai.maxTimeoutMs,
        maxRetryAttempts: oai.maxRetryAttempts,
    };
    return settings;
}

/**
 * Generic entry point: returns either Azure or OpenAI settings.
 *
 * Prefers Azure when it's configured (we're Microsoft); falls back
 * to OpenAI only when no Azure deployment / service default matches
 * the requested model type. This is the opposite of the legacy
 * `apiSettingsFromEnv`, which preferred OpenAI whenever
 * `OPENAI_API_KEY` was set — that bias is not what we want for
 * production traffic.
 */
export function apiSettingsFromConfig(
    config: Config,
    modelType: ModelType,
    deploymentName?: string,
    region?: Region,
): ApiSettings {
    // Try Azure first.
    try {
        return azureApiSettingsFromConfig(
            config,
            modelType,
            deploymentName,
            region,
        );
    } catch (azureError) {
        // Fall back to OpenAI if it's configured; otherwise rethrow
        // the more informative Azure error.
        if (config.openAI?.apiKey) {
            return openAIApiSettingsFromConfig(config, modelType);
        }
        throw azureError;
    }
}

/**
 * Build a `Config` from a flat env record. Convenience for legacy
 * callers that have an env-style `Record<string, string|undefined>`
 * in hand and want to route through the typed path.
 *
 * `undefined` values are dropped (typed Config has no notion of
 * "set to undefined").
 */
export function configFromEnvRecord(
    env: Record<string, string | undefined>,
): Config {
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) {
        if (typeof v === "string") flat[k] = v;
    }
    return buildConfig(flat);
}
