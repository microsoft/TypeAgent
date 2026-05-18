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
import type {
    AuthMode,
    Config,
    Deployment,
    DeploymentEndpoint,
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
        // Capture capacity/priority/tpm into the legacy POOL override
        // JSON so unmigrated consumers can still see them.
        if (
            endpoint.capacity !== undefined ||
            endpoint.tpm !== undefined ||
            endpoint.priority !== (endpoint.mode === "PTU" ? 1 : 2)
        ) {
            const o: Record<string, unknown> = {
                suffix: `${suffix}_${regionSuffix}`,
                region: endpoint.region,
                mode: endpoint.mode,
            };
            if (endpoint.capacity !== undefined) o.capacity = endpoint.capacity;
            if (endpoint.tpm !== undefined) o.tpm = endpoint.tpm;
            o.priority = endpoint.priority;
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

    // Speech.
    if (config.speech) {
        out.SPEECH_SDK_KEY = authToString(config.speech.auth);
        out.SPEECH_SDK_REGION = config.speech.region;
        if (config.speech.endpoint) {
            out.SPEECH_SDK_ENDPOINT = config.speech.endpoint;
        }
    }

    // Maps.
    if (config.maps) {
        out.AZURE_MAPS_CLIENTID = config.maps.clientId;
        out.AZURE_MAPS_ENDPOINT = config.maps.endpoint;
    }

    // Microsoft Graph.
    if (config.msGraph) {
        out.MSGRAPH_APP_CLIENTID = config.msGraph.clientId;
        out.MSGRAPH_APP_CLIENTSECRET = config.msGraph.clientSecret;
        out.MSGRAPH_APP_TENANTID = config.msGraph.tenantId;
        if (config.msGraph.username !== undefined) {
            out.MSGRAPH_APP_USERNAME = config.msGraph.username;
        }
        if (config.msGraph.password !== undefined) {
            out.MSGRAPH_APP_PASSWD = config.msGraph.password;
        }
    }

    // Google Calendar.
    if (config.googleCalendar) {
        out.GOOGLE_CALENDAR_CLIENT_ID = config.googleCalendar.clientId;
        out.GOOGLE_CALENDAR_CLIENT_SECRET = config.googleCalendar.clientSecret;
    }

    // Spotify.
    if (config.spotify) {
        out.SPOTIFY_APP_CLI = config.spotify.clientId;
        out.SPOTIFY_APP_CLISEC = config.spotify.clientSecret;
        out.SPOTIFY_APP_PORT = String(config.spotify.port);
    }

    // Wikipedia.
    if (config.wikipedia) {
        if (config.wikipedia.clientId) {
            out.WIKIPEDIA_CLIENT_ID = config.wikipedia.clientId;
        }
        if (config.wikipedia.clientSecret) {
            out.WIKIPEDIA_CLIENT_SECRET = config.wikipedia.clientSecret;
        }
        if (config.wikipedia.endpoint) {
            out.WIKIPEDIA_ENDPOINT = config.wikipedia.endpoint;
        }
    }

    // Storage.
    if (config.storage.azure) {
        out.AZURE_STORAGE_ACCOUNT = config.storage.azure.account;
        out.AZURE_STORAGE_CONTAINER = config.storage.azure.container;
    }
    if (config.storage.aws) {
        out.AWS_S3_BUCKET_NAME = config.storage.aws.bucketName;
        out.AWS_S3_REGION = config.storage.aws.region;
        out.AWS_ACCESS_KEY_ID = config.storage.aws.accessKeyId;
        out.AWS_SECRET_ACCESS_KEY = config.storage.aws.secretAccessKey;
    }
    if (config.storage.database?.cosmosDbConnectionString) {
        out.COSMOSDB_CONNECTION_STRING =
            config.storage.database.cosmosDbConnectionString;
    }
    if (config.storage.database?.mongoDbConnectionString) {
        out.MONGODB_CONNECTION_STRING =
            config.storage.database.mongoDbConnectionString;
    }

    // Vault.
    if (config.vault?.shared) {
        out.TYPEAGENT_SHAREDVAULT = config.vault.shared;
    }

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
