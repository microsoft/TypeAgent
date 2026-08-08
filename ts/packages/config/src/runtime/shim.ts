// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Compatibility shim: project a typed `Config` back onto the legacy
 * `process.env`-style flat key/value map.
 *
 * Used at startup so that consumers which still call
 * `getEnvSetting(env, "AZURE_OPENAI_ENDPOINT_GPT_4_O", suffix)` keep
 * working unchanged while we migrate them one at a time.
 *
 * Round-trip property: for any `Config` produced by `buildConfig(flat)`,
 * the result of `populateProcessEnv(config)` is a superset of the
 * typed sections of `flat` plus the `extra` passthrough — no typed
 * data is lost. (Some normalization happens: booleans become "1"/"0",
 * regions become uppercase env-var suffixes, etc.)
 */

import { regionToEnvSuffix } from "./regions.js";
import { SIMPLE_CONFIG_MAPPING_LIST } from "../mappings.js";
import {
    AuthMode,
    Config,
    Deployment,
    DeploymentEndpoint,
    DEFAULT_WIRE_API,
} from "./types.js";

/** A flat env-var name → value map. Same shape as `FlatEnv`. */
export type EnvOutput = Record<string, string>;

/**
 * Convert an `AuthMode` into its env-var string representation.
 * Identity becomes the literal `"identity"`; key auth becomes the
 * raw key value.
 */
function authToString(auth: AuthMode): string {
    return auth.kind === "identity" ? "identity" : auth.value;
}

function emitSimpleConfigMappings(config: Config, out: EnvOutput): void {
    for (const mapping of SIMPLE_CONFIG_MAPPING_LIST) {
        let value: unknown = config;
        for (const segment of mapping.configPath.split(".")) {
            if (
                value === undefined ||
                value === null ||
                typeof value !== "object"
            ) {
                value = undefined;
                break;
            }
            value = (value as Record<string, unknown>)[segment];
        }
        if (
            value === undefined ||
            (mapping.omitEmptyInProjection && value === "")
        ) {
            continue;
        }
        out[mapping.envVar] =
            mapping.valueKind === "auth"
                ? authToString(value as AuthMode)
                : String(value);
    }
}

function emitEndpoint(
    out: EnvOutput,
    deploymentSuffix: string,
    region: string,
    endpoint: DeploymentEndpoint,
): void {
    const suffix = `${deploymentSuffix}_${region}`;
    out[`AZURE_OPENAI_ENDPOINT_${suffix}`] = endpoint.endpoint;
    out[`AZURE_OPENAI_API_KEY_${suffix}`] = authToString(endpoint.auth);
}

function emitDeployment(out: EnvOutput, deployment: Deployment): void {
    const suffix = deployment.name.toUpperCase();
    const overrides: Array<Record<string, unknown>> = [];
    for (const endpoint of deployment.endpoints) {
        const regionSuffix =
            endpoint.mode === "PTU"
                ? `${regionToEnvSuffix(endpoint.region)}_PTU`
                : regionToEnvSuffix(endpoint.region);
        emitEndpoint(out, suffix, regionSuffix, endpoint);
        // Capture capacity/priority/tpm/wireApi into the legacy POOL
        // override JSON so unmigrated consumers can still see them.
        if (
            endpoint.capacity !== undefined ||
            endpoint.tpm !== undefined ||
            endpoint.priority !== (endpoint.mode === "PTU" ? 1 : 2) ||
            (endpoint.wireApi !== undefined &&
                endpoint.wireApi !== DEFAULT_WIRE_API)
        ) {
            const o: Record<string, unknown> = {
                suffix: `${suffix}_${regionSuffix}`,
                region: endpoint.region,
                mode: endpoint.mode,
            };
            if (endpoint.capacity !== undefined) o.capacity = endpoint.capacity;
            if (endpoint.tpm !== undefined) o.tpm = endpoint.tpm;
            o.priority = endpoint.priority;
            if (
                endpoint.wireApi !== undefined &&
                endpoint.wireApi !== DEFAULT_WIRE_API
            ) {
                o.wireApi = endpoint.wireApi;
            }
            overrides.push(o);
        }
    }
    if (overrides.length > 0) {
        // Render with bare-word keys to match the legacy format.
        const body = overrides
            .map(
                (o) =>
                    "{" +
                    Object.entries(o)
                        .map(([k, v]) =>
                            typeof v === "string" ? `${k}:${v}` : `${k}:${v}`,
                        )
                        .join(",") +
                    "}",
            )
            .join(",");
        out[`AZURE_OPENAI_POOL_${suffix}`] = `[${body}]`;
    }
}

/**
 * Build the flat env-var map. Pure function — does not touch
 * `process.env`. Use `applyToProcessEnv` to actually mutate the
 * global.
 */
export function configToEnv(config: Config): EnvOutput {
    const out: EnvOutput = {};

    // Azure OpenAI section.
    const ao = config.azureOpenAI;
    out.AZURE_OPENAI_API_KEY = authToString(ao.defaultAuth);
    out.AZURE_OPENAI_MAX_CONCURRENCY = String(ao.maxConcurrency);
    out.AZURE_OPENAI_MAX_TIMEOUT = String(ao.maxTimeoutMs);
    out.AZURE_OPENAI_MAX_RETRYATTEMPTS = String(ao.maxRetryAttempts);
    out.AZURE_OPENAI_RESPONSE_FORMAT = ao.responseFormat ? "1" : "0";
    if (ao.maxPromptChars !== undefined) {
        out.AZURE_OPENAI_MAX_CHARS = String(ao.maxPromptChars);
    }
    if (ao.enableModelRequestLogging) {
        out.ENABLE_MODEL_REQUEST_LOGGING = "true";
    }

    if (ao.defaultChat) {
        out.AZURE_OPENAI_ENDPOINT = ao.defaultChat.endpoint;
    }
    if (ao.defaultEmbedding) {
        out.AZURE_OPENAI_ENDPOINT_EMBEDDING = ao.defaultEmbedding.endpoint;
        out.AZURE_OPENAI_API_KEY_EMBEDDING = authToString(
            ao.defaultEmbedding.auth,
        );
    }
    if (ao.defaultImage) {
        out.AZURE_OPENAI_ENDPOINT_GPT_IMAGE_1_5 = ao.defaultImage.endpoint;
        out.AZURE_OPENAI_API_KEY_GPT_IMAGE_1_5 = authToString(
            ao.defaultImage.auth,
        );
    }
    if (ao.defaultVideo) {
        out.AZURE_OPENAI_ENDPOINT_SORA_2 = ao.defaultVideo.endpoint;
        out.AZURE_OPENAI_API_KEY_SORA_2 = authToString(ao.defaultVideo.auth);
    }

    for (const deployment of ao.deployments.values()) {
        emitDeployment(out, deployment);
    }

    emitSimpleConfigMappings(config, out);

    // OpenAI (main + named variants like LOCAL).
    if (config.openAI) {
        emitOpenAIVariant(out, config.openAI, "");
        if (config.openAI.local) {
            emitOpenAIVariant(out, config.openAI.local, "_LOCAL");
        }
    }

    // Azure AI Foundry / Bing-with-Grounding / Logic-App.
    if (config.azureFoundry) {
        const f = config.azureFoundry;
        if (f.bingEndpoint !== undefined)
            out.BING_WITH_GROUNDING_ENDPOINT = f.bingEndpoint;
        if (f.bingAgentId !== undefined)
            out.BING_WITH_GROUNDING_AGENT_ID = f.bingAgentId;
        if (f.bingUrlResolutionAgentId !== undefined)
            out.BING_WITH_GROUNDING_URL_RESOLUTION_AGENT_ID =
                f.bingUrlResolutionAgentId;
        if (f.bingUrlResolutionConnectionId !== undefined)
            out.BING_WITH_GROUNDING_URL_RESOLUTION_CONNECTION_ID =
                f.bingUrlResolutionConnectionId;
        if (f.validatorAgentId !== undefined)
            out.AZURE_FOUNDRY_AGENT_ID_VALIDATOR = f.validatorAgentId;
        if (f.aliasKeywordExtractorAgentId !== undefined)
            out.AZURE_FOUNDRY_AGENT_ID_ALIAS_KEYWORD_EXTRACTOR =
                f.aliasKeywordExtractorAgentId;
        if (f.openPhraseGeneratorAgentId !== undefined)
            out.AZURE_FOUNDRY_AGENT_ID_OPEN_PHRASE_GENERATOR =
                f.openPhraseGeneratorAgentId;
        if (f.httpEndpointLogicAppConnectionId !== undefined)
            out.LOGIC_APP_CONNECTION_ID_GET_HTTP_ENDPOINT =
                f.httpEndpointLogicAppConnectionId;
    }

    // Azure AI Search (Foundry IQ) browser-less lookup.
    if (config.azureAISearch) {
        const s = config.azureAISearch;
        if (s.mode !== undefined) out.AZURE_AI_SEARCH_LOOKUP_MODE = s.mode;
        if (s.endpoint !== undefined) out.AZURE_AI_SEARCH_ENDPOINT = s.endpoint;
        if (s.knowledgeBase !== undefined)
            out.AZURE_AI_SEARCH_KNOWLEDGE_BASE = s.knowledgeBase;
        if (s.apiKey !== undefined) out.AZURE_AI_SEARCH_API_KEY = s.apiKey;
        if (s.bearerToken !== undefined)
            out.AZURE_AI_SEARCH_BEARER_TOKEN = s.bearerToken;
        if (s.apiVersion !== undefined)
            out.AZURE_AI_SEARCH_API_VERSION = s.apiVersion;
        if (s.outputMode !== undefined)
            out.AZURE_AI_SEARCH_OUTPUT_MODE = s.outputMode;
        if (s.reasoningEffort !== undefined)
            out.AZURE_AI_SEARCH_REASONING_EFFORT = s.reasoningEffort;
        if (s.aoaiEndpoint !== undefined)
            out.AZURE_AI_SEARCH_AOAI_ENDPOINT = s.aoaiEndpoint;
        if (s.aoaiDeployment !== undefined)
            out.AZURE_AI_SEARCH_AOAI_DEPLOYMENT = s.aoaiDeployment;
        if (s.aoaiModel !== undefined)
            out.AZURE_AI_SEARCH_AOAI_MODEL = s.aoaiModel;
        if (s.aoaiApiKey !== undefined)
            out.AZURE_AI_SEARCH_AOAI_API_KEY = s.aoaiApiKey;
        if (s.webKnowledgeSource !== undefined)
            out.AZURE_AI_SEARCH_WEB_KS_NAME = s.webKnowledgeSource;
        if (s.webKnowledgeSourceDomains !== undefined)
            out.AZURE_AI_SEARCH_WEB_KS_DOMAINS = s.webKnowledgeSourceDomains;
    }

    // Embedding provider selection.
    if (config.embedding) {
        if (config.embedding.provider !== undefined)
            out.TYPEAGENT_EMBEDDING_PROVIDER = config.embedding.provider;
        if (config.embedding.model !== undefined)
            out.TYPEAGENT_EMBEDDING_MODEL = config.embedding.model;
        if (config.embedding.cacheDir !== undefined)
            out.TYPEAGENT_EMBEDDING_CACHE_DIR = config.embedding.cacheDir;
    }

    // Extra: untyped passthrough. Last so it can override typed values
    // for keys we haven't migrated yet (the user wrote them explicitly).
    for (const [k, v] of config.extra) {
        out[k] = v;
    }

    return out;
}

function emitOpenAIVariant(
    out: EnvOutput,
    o: {
        apiKey: string;
        endpoint?: string | undefined;
        endpointEmbedding?: string | undefined;
        model?: string | undefined;
        modelEmbedding?: string | undefined;
        organization?: string | undefined;
        responseFormat: boolean;
        maxConcurrency: number;
        maxTimeoutMs: number;
        maxRetryAttempts: number;
    },
    suffix: string,
): void {
    // Skip the synthetic empty main variant created when only LOCAL is
    // configured — it has no apiKey and would emit garbage env vars.
    if (suffix === "" && o.apiKey === "") return;
    out[`OPENAI_API_KEY${suffix}`] = o.apiKey;
    if (o.endpoint !== undefined) out[`OPENAI_ENDPOINT${suffix}`] = o.endpoint;
    if (o.endpointEmbedding !== undefined)
        out[`OPENAI_ENDPOINT_EMBEDDING${suffix}`] = o.endpointEmbedding;
    if (o.model !== undefined) out[`OPENAI_MODEL${suffix}`] = o.model;
    if (o.modelEmbedding !== undefined)
        out[`OPENAI_MODEL_EMBEDDING${suffix}`] = o.modelEmbedding;
    if (o.organization !== undefined)
        out[`OPENAI_ORGANIZATION${suffix}`] = o.organization;
    out[`OPENAI_RESPONSE_FORMAT${suffix}`] = o.responseFormat ? "1" : "0";
    out[`OPENAI_MAX_CONCURRENCY${suffix}`] = String(o.maxConcurrency);
    out[`OPENAI_MAX_TIMEOUT${suffix}`] = String(o.maxTimeoutMs);
    out[`OPENAI_MAX_RETRYATTEMPTS${suffix}`] = String(o.maxRetryAttempts);
}

/**
 * Apply the env projection of `config` to `process.env` (or any other
 * env-style record). By default does NOT overwrite existing values —
 * matches the long-standing loader convention that explicit `process.env`
 * wins over file-based config.
 */
export function applyToProcessEnv(
    config: Config,
    options: {
        target?: NodeJS.ProcessEnv;
        overwrite?: boolean;
    } = {},
): void {
    const target = options.target ?? process.env;
    const overwrite = options.overwrite ?? false;
    const projected = configToEnv(config);
    for (const [k, v] of Object.entries(projected)) {
        if (!overwrite && target[k] !== undefined) continue;
        target[k] = v;
    }
}
