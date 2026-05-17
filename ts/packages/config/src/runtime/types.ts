// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Typed runtime configuration surface.
 *
 * This is the API consumers will eventually call instead of reading
 * `process.env.AZURE_OPENAI_*` directly. It is intentionally:
 *
 *  - **Immutable**: every field is `readonly`. A `Config` is built once
 *    by the loader and shared. Mutations require a reload.
 *  - **Discriminated**: `AuthMode` makes "use managed identity" a
 *    first-class state instead of a magic string `"identity"`.
 *  - **Sparse**: every section other than `azureOpenAI` and `extra` is
 *    optional. Consumers that need a section assert its presence at
 *    their boundary; missing sections produce clean error messages.
 *  - **Backed by an escape hatch**: `extra` carries any flat env-var
 *    keys we haven't promoted to typed accessors yet. Phase 3 will
 *    progressively shrink it.
 */

import type { Region } from "./regions.js";

/** Authentication mode for an Azure resource. */
export type AuthMode =
    | { readonly kind: "identity" }
    | { readonly kind: "key"; readonly value: string };

export const IDENTITY: AuthMode = { kind: "identity" };

export function authModeFromString(s: string | undefined): AuthMode {
    if (s === undefined || s === "" || s.toLowerCase() === "identity") {
        return IDENTITY;
    }
    return { kind: "key", value: s };
}

/** Whether a deployment is pay-as-you-go or provisioned-throughput. */
export type DeploymentMode = "PAYG" | "PTU";

/** A single regional endpoint of an Azure OpenAI deployment. */
export interface DeploymentEndpoint {
    /** Full chat/completions/embeddings/images URL. */
    readonly endpoint: string;
    /** Authentication for this endpoint; falls back to `defaultAuth`. */
    readonly auth: AuthMode;
    /**
     * Region this endpoint serves. Auto-derived from the URL hostname
     * when not explicitly set in YAML; required for cooldown / pool
     * accounting.
     */
    readonly region: Region;
    readonly mode: DeploymentMode;
    /** 1 = preferred tier; defaults to 1 for PTU, 2 for PAYG. */
    readonly priority: number;
    /** Declared TPM/RPM capacity (informational; used for routing hints). */
    readonly capacity?: number | undefined;
    /** Declared TPM (for pool routing weight); from legacy POOL override JSON. */
    readonly tpm?: number | undefined;
}

/**
 * A named Azure OpenAI deployment. The `endpoints` list is in
 * priority order (lowest priority value first; ties preserve insertion
 * order) and is the canonical pool used for routing.
 */
export interface Deployment {
    readonly name: string;
    readonly endpoints: readonly DeploymentEndpoint[];
}

export interface AzureOpenAIConfig {
    /** Auth used by deployments / bare endpoints that don't specify one. */
    readonly defaultAuth: AuthMode;

    readonly maxConcurrency: number;
    readonly maxTimeoutMs: number;
    readonly maxRetryAttempts: number;
    /** Whether to send `response_format: json_object` on chat requests. */
    readonly responseFormat: boolean;
    readonly enableModelRequestLogging: boolean;
    readonly maxPromptChars?: number | undefined;

    /**
     * Section-level default capacity applied to every deployment endpoint
     * that doesn't specify its own capacity (either directly on the
     * endpoint or via a per-deployment `defaultCapacity`).
     */
    readonly defaultCapacity?: number | undefined;

    /** Bare `AZURE_OPENAI_ENDPOINT` (legacy default chat target). */
    readonly defaultChat?: DeploymentEndpoint | undefined;
    readonly defaultEmbedding?: DeploymentEndpoint | undefined;
    readonly defaultImage?: DeploymentEndpoint | undefined;
    readonly defaultVideo?: DeploymentEndpoint | undefined;

    readonly deployments: ReadonlyMap<string, Deployment>;
}

export interface OpenAIConfig {
    readonly apiKey: string;
    readonly endpoint?: string | undefined;
    readonly endpointEmbedding?: string | undefined;
    readonly model?: string | undefined;
    readonly modelEmbedding?: string | undefined;
    readonly organization?: string | undefined;
    readonly responseFormat: boolean;
    readonly maxConcurrency: number;
    readonly maxTimeoutMs: number;
    readonly maxRetryAttempts: number;
    /** Local-OpenAI-API-compatible target (Ollama, etc.). */
    readonly local?: OpenAIConfig | undefined;
}

export interface SpeechConfig {
    readonly auth: AuthMode;
    readonly region: Region;
    readonly endpoint?: string | undefined;
}

export interface MapsConfig {
    readonly clientId: string;
    readonly endpoint: string;
}

export interface MicrosoftGraphConfig {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly tenantId: string;
    readonly username?: string | undefined;
    readonly password?: string | undefined;
}

export interface GoogleCalendarConfig {
    readonly clientId: string;
    readonly clientSecret: string;
}

export interface SpotifyConfig {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly port: number;
}

export interface WikipediaConfig {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly endpoint: string;
}

export interface AzureStorageConfig {
    readonly account: string;
    readonly container: string;
}

export interface AwsStorageConfig {
    readonly bucketName: string;
    readonly region: string;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
}

export interface ElasticConfig {
    readonly apiKey: string;
    readonly uri: string;
}

export interface DatabaseConfig {
    readonly cosmosDbConnectionString?: string | undefined;
    readonly mongoDbConnectionString?: string | undefined;
}

export interface StorageConfig {
    readonly azure?: AzureStorageConfig | undefined;
    readonly aws?: AwsStorageConfig | undefined;
    readonly database?: DatabaseConfig | undefined;
    readonly elastic?: ElasticConfig | undefined;
}

export interface VaultConfig {
    /** Name of the shared Azure Key Vault (e.g. "aisystems"). */
    readonly shared?: string | undefined;
}

/**
 * Azure AI Foundry configuration: Bing-with-Grounding endpoints, agent
 * identifiers, and the Logic-App connection used for HTTP tool dispatch.
 * Mirrors the legacy `AZURE_FOUNDRY_*` / `BING_WITH_GROUNDING_*` /
 * `LOGIC_APP_CONNECTION_ID_*` env vars. All fields optional so partial
 * configurations remain valid.
 */
export interface AzureFoundryConfig {
    /** BING_WITH_GROUNDING_ENDPOINT */
    readonly bingEndpoint?: string | undefined;
    /** BING_WITH_GROUNDING_AGENT_ID */
    readonly bingAgentId?: string | undefined;
    /** BING_WITH_GROUNDING_URL_RESOLUTION_AGENT_ID */
    readonly bingUrlResolutionAgentId?: string | undefined;
    /** BING_WITH_GROUNDING_URL_RESOLUTION_CONNECTION_ID */
    readonly bingUrlResolutionConnectionId?: string | undefined;
    /** AZURE_FOUNDRY_AGENT_ID_VALIDATOR */
    readonly validatorAgentId?: string | undefined;
    /** AZURE_FOUNDRY_AGENT_ID_ALIAS_KEYWORD_EXTRACTOR */
    readonly aliasKeywordExtractorAgentId?: string | undefined;
    /** AZURE_FOUNDRY_AGENT_ID_OPEN_PHRASE_GENERATOR */
    readonly openPhraseGeneratorAgentId?: string | undefined;
    /** LOGIC_APP_CONNECTION_ID_GET_HTTP_ENDPOINT */
    readonly httpEndpointLogicAppConnectionId?: string | undefined;
}

export interface ReasoningConfig {
    /** Reasoning-loop timeout in milliseconds (0 = disabled). */
    readonly timeoutMs?: number | undefined;
    /** Override the default Copilot reasoning model. */
    readonly copilotModel?: string | undefined;
}

/** Root typed configuration. */
export interface Config {
    readonly azureOpenAI: AzureOpenAIConfig;
    readonly openAI?: OpenAIConfig | undefined;
    readonly speech?: SpeechConfig | undefined;
    readonly maps?: MapsConfig | undefined;
    readonly msGraph?: MicrosoftGraphConfig | undefined;
    readonly googleCalendar?: GoogleCalendarConfig | undefined;
    readonly spotify?: SpotifyConfig | undefined;
    readonly wikipedia?: WikipediaConfig | undefined;
    readonly storage: StorageConfig;
    readonly vault?: VaultConfig | undefined;
    readonly azureFoundry?: AzureFoundryConfig | undefined;
    readonly reasoning?: ReasoningConfig | undefined;
    /**
     * Untyped passthrough: any flat `KEY=value` pair that wasn't
     * recognized by the typed schema lives here. This is what makes
     * the migration incremental — unmigrated consumers can still find
     * their values via the compatibility shim.
     */
    readonly extra: ReadonlyMap<string, string>;
}
