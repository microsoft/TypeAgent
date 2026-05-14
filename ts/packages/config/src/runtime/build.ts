// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Build a typed `Config` from a flat env-var map (`FlatEnv`).
 *
 * The flat map is the lingua franca produced by either:
 *   - flattening structured YAML (`flatten()` on a `ConfigTree`), or
 *   - parsing a legacy `.env` file (`parseDotEnvFile`).
 *
 * The builder pattern-recognizes the long-standing
 * `AZURE_OPENAI_<LEAF>_<DEPLOYMENT>_<REGION>[_PTU]` env-var convention
 * and lifts it into the typed `Deployment` / `DeploymentEndpoint`
 * structure. Anything it doesn't recognize lands in `Config.extra`
 * verbatim, so unmigrated consumers (and the compatibility shim) can
 * still find their values.
 *
 * The builder is the dual of `populateProcessEnv` in the same package:
 * any `Config` round-trips through `populateProcessEnv → buildConfig`
 * losslessly for typed sections, and bit-identically for `extra`.
 */

import type { FlatEnv } from "../types.js";
import {
    isRegion,
    regionFromEnvSuffix,
    regionFromUrl,
    type Region,
} from "./regions.js";
import {
    AuthMode,
    authModeFromString,
    Config,
    Deployment,
    DeploymentEndpoint,
    DeploymentMode,
    type AzureOpenAIConfig,
} from "./types.js";

/**
 * Result of analyzing an `AZURE_OPENAI_(API_KEY|ENDPOINT)_<SUFFIX>` key.
 * `suffix` is the raw env-var suffix (e.g. `GPT_4_O_EASTUS_PTU`);
 * `deployment` is the lowercase deployment name extracted from the
 * leading tokens; `region` and `mode` are pulled from the trailing
 * tokens when recognizable.
 */
interface SuffixParse {
    readonly suffix: string;
    readonly deployment: string;
    readonly region?: Region | undefined;
    readonly mode: DeploymentMode;
}

function parseSuffix(suffix: string): SuffixParse {
    let tokens = suffix.split("_").filter((t) => t.length > 0);
    let mode: DeploymentMode = "PAYG";

    // Trailing _PTU marks a provisioned-throughput variant.
    if (
        tokens.length > 0 &&
        tokens[tokens.length - 1].toUpperCase() === "PTU"
    ) {
        mode = "PTU";
        tokens = tokens.slice(0, -1);
    }

    // Try to peel off a trailing region. Azure regions are 1-3 underscore-
    // joined tokens (e.g. CANADACENTRAL, NORTH_CENTRAL_US is theoretical;
    // actual region tokens like `northcentralus` are written contiguous).
    // We try 1, 2, 3 trailing tokens and accept the longest match.
    let region: Region | undefined;
    for (let take = 3; take >= 1; take--) {
        if (tokens.length < take) continue;
        const candidate = tokens.slice(-take).join("").toLowerCase();
        const r = regionFromEnvSuffix(candidate);
        if (r !== undefined) {
            region = r;
            tokens = tokens.slice(0, -take);
            break;
        }
    }

    // Whatever remains is the deployment name (lowercase-snake).
    const deployment = tokens.join("_").toLowerCase();
    return { suffix, deployment, region, mode };
}

/** Default priority by mode: PTU prefers tier 1, PAYG falls to tier 2. */
function defaultPriority(mode: DeploymentMode): number {
    return mode === "PTU" ? 1 : 2;
}

function makeEndpoint(
    endpoint: string,
    region: Region,
    mode: DeploymentMode,
    auth: AuthMode,
    capacity?: number,
    priority?: number,
    tpm?: number,
): DeploymentEndpoint {
    const ep: DeploymentEndpoint = {
        endpoint,
        auth,
        region,
        mode,
        priority: priority ?? defaultPriority(mode),
        ...(capacity !== undefined ? { capacity } : {}),
        ...(tpm !== undefined ? { tpm } : {}),
    };
    return ep;
}

function popString(flat: Map<string, string>, key: string): string | undefined {
    const v = flat.get(key);
    if (v !== undefined) flat.delete(key);
    return v;
}

function popInt(
    flat: Map<string, string>,
    key: string,
    fallback?: number,
): number | undefined {
    const raw = popString(flat, key);
    if (raw === undefined) return fallback;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return fallback;
    return n;
}

function popBool(flat: Map<string, string>, key: string): boolean {
    const raw = popString(flat, key);
    if (raw === undefined) return false;
    // Long-standing project convention: `1` / `true` are truthy.
    return raw === "1" || raw.toLowerCase() === "true";
}

/**
 * Build the typed `Config` from a flat env map. The input map is not
 * mutated; the builder works on a private copy so it can pop keys as
 * it consumes them and route the leftovers into `Config.extra`.
 */
export function buildConfig(flat: FlatEnv): Config {
    const remaining = new Map(Object.entries(flat));

    const azureOpenAI = buildAzureOpenAI(remaining);
    const openAI = buildOpenAI(remaining);
    const speech = buildSpeech(remaining);
    const maps = buildMaps(remaining);
    const msGraph = buildMsGraph(remaining);
    const googleCalendar = buildGoogleCalendar(remaining);
    const spotify = buildSpotify(remaining);
    const wikipedia = buildWikipedia(remaining);
    const storage = buildStorage(remaining);
    const vault = buildVault(remaining);
    const azureFoundry = buildAzureFoundry(remaining);
    const reasoning = buildReasoning(remaining);

    return {
        azureOpenAI,
        ...(openAI ? { openAI } : {}),
        speech,
        maps,
        msGraph,
        googleCalendar,
        spotify,
        wikipedia,
        storage,
        vault,
        ...(azureFoundry ? { azureFoundry } : {}),
        ...(reasoning ? { reasoning } : {}),
        extra: new Map(remaining),
    };
}

// ----------------------------------------------------------------------------
// Azure OpenAI
// ----------------------------------------------------------------------------

function buildAzureOpenAI(flat: Map<string, string>): AzureOpenAIConfig {
    const defaultAuthRaw = popString(flat, "AZURE_OPENAI_API_KEY");
    const defaultAuth = authModeFromString(defaultAuthRaw);

    const maxConcurrency = popInt(flat, "AZURE_OPENAI_MAX_CONCURRENCY", 4)!;
    const maxTimeoutMs = popInt(flat, "AZURE_OPENAI_MAX_TIMEOUT", 60_000)!;
    const maxRetryAttempts = popInt(flat, "AZURE_OPENAI_MAX_RETRYATTEMPTS", 3)!;
    const responseFormat = popBool(flat, "AZURE_OPENAI_RESPONSE_FORMAT");
    const enableModelRequestLogging = popBool(
        flat,
        "ENABLE_MODEL_REQUEST_LOGGING",
    );
    const maxPromptChars = popInt(flat, "AZURE_OPENAI_MAX_CHARS");

    // Bare default chat endpoint (legacy AZURE_OPENAI_ENDPOINT).
    const defaultChatEndpoint = popString(flat, "AZURE_OPENAI_ENDPOINT");
    const defaultChat = defaultChatEndpoint
        ? makeBareEndpoint(defaultChatEndpoint, defaultAuth)
        : undefined;

    // Service defaults: peel off bare embedding / image / video endpoints
    // before the deployment-suffix scan so they don't get mistaken for
    // deployment entries.
    const defaultEmbedding = popServiceDefault(
        flat,
        ["EMBEDDING"],
        defaultAuth,
    );
    const defaultImage = popServiceDefault(
        flat,
        ["GPT_IMAGE_1_5"],
        defaultAuth,
    );
    const defaultVideo = popServiceDefault(flat, ["SORA_2"], defaultAuth);

    // Everything else with the AZURE_OPENAI_(ENDPOINT|API_KEY)_<SUFFIX>
    // shape is a deployment endpoint. Group by deployment name.
    const deployments = collectDeployments(flat, defaultAuth);

    // Synthesize service defaults from the deployment list when not
    // explicitly set. Legacy aiclient consumers (`createChatModelDefault`,
    // bare `AZURE_OPENAI_ENDPOINT` lookups, etc.) need a fallback URL
    // when no model name is specified. We pick the first endpoint of a
    // conventional deployment in priority order.
    const synthDefault = (names: string[]): DeploymentEndpoint | undefined => {
        for (const n of names) {
            const dep = deployments.get(n);
            if (dep && dep.endpoints.length > 0) return dep.endpoints[0];
        }
        return undefined;
    };
    // For chat we additionally fall back to *any* configured deployment if
    // none of the conventional names match — so a YAML that only defines
    // exotic deployment names still yields a usable bare default endpoint.
    const synthAnyChat = (): DeploymentEndpoint | undefined => {
        for (const dep of deployments.values()) {
            if (dep.endpoints.length > 0) return dep.endpoints[0];
        }
        return undefined;
    };
    const finalDefaultChat =
        defaultChat ??
        synthDefault(["gpt_4_o", "gpt_4_1", "gpt_5"]) ??
        synthAnyChat();
    const finalDefaultEmbedding =
        defaultEmbedding ?? synthDefault(["embedding", "embedding_3_large"]);
    const finalDefaultImage =
        defaultImage ?? synthDefault(["gpt_image_1_5"]);
    const finalDefaultVideo = defaultVideo ?? synthDefault(["sora_2"]);

    return {
        defaultAuth,
        maxConcurrency,
        maxTimeoutMs,
        maxRetryAttempts,
        responseFormat,
        enableModelRequestLogging,
        ...(maxPromptChars !== undefined ? { maxPromptChars } : {}),
        ...(finalDefaultChat ? { defaultChat: finalDefaultChat } : {}),
        ...(finalDefaultEmbedding ? { defaultEmbedding: finalDefaultEmbedding } : {}),
        ...(finalDefaultImage ? { defaultImage: finalDefaultImage } : {}),
        ...(finalDefaultVideo ? { defaultVideo: finalDefaultVideo } : {}),
        deployments,
    };
}

function makeBareEndpoint(
    endpoint: string,
    auth: AuthMode,
): DeploymentEndpoint {
    // Bare endpoints have no known region; we surface them with a
    // sentinel region of "eastus" only so the type stays well-formed.
    // Consumers should never read `.region` off a bare endpoint they
    // got from `defaultChat`/`defaultEmbedding`/etc. — those exist to
    // model the legacy "AZURE_OPENAI_ENDPOINT" case where region is
    // unknowable from env vars alone.
    return {
        endpoint,
        auth,
        region: "eastus",
        mode: "PAYG",
        priority: 1,
    };
}

/**
 * Pop a service-default (`EMBEDDING`, `GPT_IMAGE_1_5`, `SORA_2`) bare
 * endpoint+key pair from `flat`. Tries each candidate name in order
 * (the first one with an endpoint set wins).
 */
function popServiceDefault(
    flat: Map<string, string>,
    candidateNames: readonly string[],
    inheritedAuth: AuthMode,
): DeploymentEndpoint | undefined {
    for (const name of candidateNames) {
        const endpoint = popString(flat, `AZURE_OPENAI_ENDPOINT_${name}`);
        const keyRaw = popString(flat, `AZURE_OPENAI_API_KEY_${name}`);
        if (endpoint !== undefined) {
            const auth =
                keyRaw !== undefined
                    ? authModeFromString(keyRaw)
                    : inheritedAuth;
            return makeBareEndpoint(endpoint, auth);
        }
    }
    return undefined;
}

interface PartialEndpoint {
    endpoint?: string;
    auth?: AuthMode;
    region?: Region;
    mode: DeploymentMode;
    capacity?: number;
    priority?: number;
    tpm?: number;
}

/** Per-suffix overrides parsed from `AZURE_OPENAI_POOL_<DEPLOYMENT>` JSON. */
interface PoolOverride {
    suffix: string;
    region?: Region;
    mode?: DeploymentMode;
    capacity?: number;
    priority?: number;
    tpm?: number;
}

/**
 * Parse a legacy `AZURE_OPENAI_POOL_*` value, which is a near-JSON
 * array using bare-word keys like `[{suffix:GPT_4_O_EASTUS,...}]`.
 * Returns the parsed entries, or `undefined` if the value is missing
 * or unparseable.
 */
function parsePoolOverride(raw: string | undefined): PoolOverride[] | undefined {
    if (raw === undefined) return undefined;
    // The legacy format is near-JSON with bare-word keys *and* bare-word
    // string values, e.g. `[{suffix:GPT_4_O_EASTUS,region:eastus,mode:PAYG}]`.
    // Quote both keys (preceded by `{` or `,`) and bare-word values
    // (followed by `,`, `}`, or `]`) to make it valid JSON. Numbers and
    // already-quoted strings pass through untouched.
    const json = raw
        .replace(/([{,])\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
        .replace(/:\s*([A-Za-z_][A-Za-z0-9_]*)\s*([,}\]])/g, ':"$1"$2');
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        return undefined;
    }
    if (!Array.isArray(parsed)) return undefined;
    const out: PoolOverride[] = [];
    for (const e of parsed) {
        if (e && typeof e === "object" && typeof (e as any).suffix === "string") {
            const o = e as Record<string, unknown>;
            const ov: PoolOverride = { suffix: o.suffix as string };
            if (typeof o.region === "string" && isRegion(o.region))
                ov.region = o.region as Region;
            if (o.mode === "PTU" || o.mode === "PAYG") ov.mode = o.mode;
            if (typeof o.capacity === "number") ov.capacity = o.capacity;
            if (typeof o.priority === "number") ov.priority = o.priority;
            if (typeof o.tpm === "number") ov.tpm = o.tpm;
            out.push(ov);
        }
    }
    return out;
}

function collectDeployments(
    flat: Map<string, string>,
    defaultAuth: AuthMode,
): Map<string, Deployment> {
    // Group endpoint + key parses by (deployment, suffix).
    // The suffix is the unique runtime identity of an endpoint (bakes
    // region + PTU into one string), letting us match endpoint and key
    // lines that came in with different casing or ordering.
    interface PartialBySuffix {
        deployment: string;
        bySuffix: Map<string, PartialEndpoint>;
    }
    const partials = new Map<string, PartialBySuffix>();

    function ensure(deployment: string): Map<string, PartialEndpoint> {
        let p = partials.get(deployment);
        if (!p) {
            p = { deployment, bySuffix: new Map() };
            partials.set(deployment, p);
        }
        return p.bySuffix;
    }

    // Snapshot keys before iterating; we mutate `flat` while walking.
    // Track which raw keys contributed to each (deployment, suffix)
    // partial so we can restore them to `flat` if the partial fails to
    // materialize (e.g. no derivable region).
    const partialKeys = new Map<PartialEndpoint, string[]>();
    const keys = [...flat.keys()];
    for (const key of keys) {
        const endpointMatch = /^AZURE_OPENAI_ENDPOINT_(.+)$/.exec(key);
        const keyMatch = /^AZURE_OPENAI_API_KEY_(.+)$/.exec(key);
        if (!endpointMatch && !keyMatch) continue;
        const suffix = (endpointMatch ?? keyMatch)![1];
        const value = flat.get(key)!;

        const parse = parseSuffix(suffix);
        if (parse.deployment.length === 0) continue;
        flat.delete(key);
        const bySuffix = ensure(parse.deployment);
        let partial = bySuffix.get(parse.suffix);
        if (!partial) {
            partial = { mode: parse.mode };
            if (parse.region !== undefined) partial.region = parse.region;
            bySuffix.set(parse.suffix, partial);
            partialKeys.set(partial, []);
        }
        partialKeys.get(partial)!.push(key);
        if (endpointMatch) {
            partial.endpoint = value;
        } else {
            partial.auth = authModeFromString(value);
        }
    }

    // Apply AZURE_OPENAI_POOL_<DEPLOYMENT> overrides where present.
    // The override list keys on the legacy suffix string and carries
    // sku / capacity / priority / tpm that the deployment-suffix env
    // vars cannot express on their own. Consumed (deleted) so they
    // don't survive into Config.extra.
    for (const [name, group] of partials) {
        const poolKey = `AZURE_OPENAI_POOL_${name.toUpperCase()}`;
        const overrides = parsePoolOverride(flat.get(poolKey));
        if (overrides !== undefined) {
            flat.delete(poolKey);
            for (const ov of overrides) {
                const partial = group.bySuffix.get(ov.suffix);
                if (!partial) continue;
                if (ov.mode !== undefined) partial.mode = ov.mode;
                if (ov.region !== undefined && partial.region === undefined)
                    partial.region = ov.region;
                if (ov.capacity !== undefined) partial.capacity = ov.capacity;
                if (ov.priority !== undefined) partial.priority = ov.priority;
                if (ov.tpm !== undefined) partial.tpm = ov.tpm;
            }
        }
    }

    // Materialize: only entries with an endpoint become DeploymentEndpoints;
    // entries with only a key are dropped (and would already be in `extra`
    // if we hadn't deleted them — which we did, so this is data loss for
    // pathological inputs. That's acceptable: a key without an endpoint is
    // not a valid deployment in any case.)
    const result = new Map<string, Deployment>();
    for (const [name, group] of partials) {
        const list: DeploymentEndpoint[] = [];
        for (const partial of group.bySuffix.values()) {
            if (!partial.endpoint) continue;
            // Last-ditch region derivation from URL host.
            const region =
                partial.region ?? regionFromUrl(partial.endpoint);
            if (!region) {
                // Restore raw keys so the value isn't lost.
                const orig = partialKeys.get(partial) ?? [];
                for (const k of orig) {
                    if (!flat.has(k)) {
                        // Reconstruct value from partial: this branch
                        // only runs for unmaterializable partials, so
                        // we know endpoint/auth came from the raw flat
                        // map. Look up via the raw key prefix.
                        if (k.startsWith("AZURE_OPENAI_ENDPOINT_")) {
                            if (partial.endpoint) flat.set(k, partial.endpoint);
                        } else if (k.startsWith("AZURE_OPENAI_API_KEY_")) {
                            if (partial.auth)
                                flat.set(
                                    k,
                                    partial.auth.kind === "identity"
                                        ? "identity"
                                        : partial.auth.value,
                                );
                        }
                    }
                }
                continue;
            }
            const auth = partial.auth ?? defaultAuth;
            list.push(
                makeEndpoint(
                    partial.endpoint,
                    region,
                    partial.mode,
                    auth,
                    partial.capacity,
                    partial.priority,
                    partial.tpm,
                ),
            );
        }
        if (list.length === 0) continue;
        list.sort((a, b) => a.priority - b.priority);
        result.set(name, { name, endpoints: list });
    }
    return result;
}

// ----------------------------------------------------------------------------
// Speech / Maps / Identity / Database / Storage
// ----------------------------------------------------------------------------

function buildOpenAI(flat: Map<string, string>) {
    const main = buildOpenAIVariant(flat, "");
    const local = buildOpenAIVariant(flat, "_LOCAL");
    if (!main && !local) return undefined;
    if (!main) {
        // Only a local variant configured. Synthesize a stub main with
        // an empty apiKey so consumers can still discriminate; the
        // typed `openAI` slot's main fields are largely unused when
        // only `local` is set.
        return { ...emptyOpenAI(), local };
    }
    return local ? { ...main, local } : main;
}

function emptyOpenAI() {
    return {
        apiKey: "",
        responseFormat: false,
        maxConcurrency: 4,
        maxTimeoutMs: 60_000,
        maxRetryAttempts: 3,
    };
}

function buildOpenAIVariant(flat: Map<string, string>, suffix: string) {
    const apiKey = popString(flat, `OPENAI_API_KEY${suffix}`);
    const endpoint = popString(flat, `OPENAI_ENDPOINT${suffix}`);
    const endpointEmbedding = popString(
        flat,
        `OPENAI_ENDPOINT_EMBEDDING${suffix}`,
    );
    const model = popString(flat, `OPENAI_MODEL${suffix}`);
    const modelEmbedding = popString(flat, `OPENAI_MODEL_EMBEDDING${suffix}`);
    const organization = popString(flat, `OPENAI_ORGANIZATION${suffix}`);
    const responseFormat = popBool(flat, `OPENAI_RESPONSE_FORMAT${suffix}`);
    const maxConcurrency = popInt(
        flat,
        `OPENAI_MAX_CONCURRENCY${suffix}`,
        4,
    )!;
    const maxTimeoutMs = popInt(flat, `OPENAI_MAX_TIMEOUT${suffix}`, 60_000)!;
    const maxRetryAttempts = popInt(
        flat,
        `OPENAI_MAX_RETRYATTEMPTS${suffix}`,
        3,
    )!;

    if (apiKey === undefined) {
        // Restore any popped values so they survive into `extra` —
        // an OpenAI variant without an API key is meaningless.
        if (endpoint !== undefined)
            flat.set(`OPENAI_ENDPOINT${suffix}`, endpoint);
        if (endpointEmbedding !== undefined)
            flat.set(`OPENAI_ENDPOINT_EMBEDDING${suffix}`, endpointEmbedding);
        if (model !== undefined) flat.set(`OPENAI_MODEL${suffix}`, model);
        if (modelEmbedding !== undefined)
            flat.set(`OPENAI_MODEL_EMBEDDING${suffix}`, modelEmbedding);
        if (organization !== undefined)
            flat.set(`OPENAI_ORGANIZATION${suffix}`, organization);
        return undefined;
    }

    return {
        apiKey,
        ...(endpoint !== undefined ? { endpoint } : {}),
        ...(endpointEmbedding !== undefined ? { endpointEmbedding } : {}),
        ...(model !== undefined ? { model } : {}),
        ...(modelEmbedding !== undefined ? { modelEmbedding } : {}),
        ...(organization !== undefined ? { organization } : {}),
        responseFormat,
        maxConcurrency,
        maxTimeoutMs,
        maxRetryAttempts,
    };
}

function buildSpeech(flat: Map<string, string>) {
    const keyRaw = popString(flat, "SPEECH_SDK_KEY");
    const region = popString(flat, "SPEECH_SDK_REGION");
    const endpoint = popString(flat, "SPEECH_SDK_ENDPOINT");
    if (!region) return undefined;
    if (!isRegion(region)) {
        // Unknown region — leave the keys in `extra` rather than
        // producing a malformed typed object.
        if (keyRaw !== undefined) flat.set("SPEECH_SDK_KEY", keyRaw);
        flat.set("SPEECH_SDK_REGION", region);
        if (endpoint !== undefined) flat.set("SPEECH_SDK_ENDPOINT", endpoint);
        return undefined;
    }
    return {
        auth: authModeFromString(keyRaw),
        region,
        ...(endpoint !== undefined ? { endpoint } : {}),
    };
}

function buildMaps(flat: Map<string, string>) {
    const clientId = popString(flat, "AZURE_MAPS_CLIENTID");
    const endpoint = popString(flat, "AZURE_MAPS_ENDPOINT");
    if (!clientId || !endpoint) {
        if (clientId !== undefined) flat.set("AZURE_MAPS_CLIENTID", clientId);
        if (endpoint !== undefined) flat.set("AZURE_MAPS_ENDPOINT", endpoint);
        return undefined;
    }
    return { clientId, endpoint };
}

function buildMsGraph(flat: Map<string, string>) {
    const clientId = popString(flat, "MSGRAPH_APP_CLIENTID");
    const clientSecret = popString(flat, "MSGRAPH_APP_CLIENTSECRET");
    const tenantId = popString(flat, "MSGRAPH_APP_TENANTID");
    const username = popString(flat, "MSGRAPH_APP_USERNAME");
    const password = popString(flat, "MSGRAPH_APP_PASSWD");
    if (!clientId && !clientSecret && !tenantId) return undefined;
    return {
        clientId: clientId ?? "",
        clientSecret: clientSecret ?? "",
        tenantId: tenantId ?? "",
        ...(username !== undefined ? { username } : {}),
        ...(password !== undefined ? { password } : {}),
    };
}

function buildGoogleCalendar(flat: Map<string, string>) {
    const clientId = popString(flat, "GOOGLE_CALENDAR_CLIENT_ID");
    const clientSecret = popString(flat, "GOOGLE_CALENDAR_CLIENT_SECRET");
    if (!clientId || !clientSecret) return undefined;
    return { clientId, clientSecret };
}

function buildSpotify(flat: Map<string, string>) {
    const clientId = popString(flat, "SPOTIFY_APP_CLI");
    const clientSecret = popString(flat, "SPOTIFY_APP_CLISEC");
    const portStr = popString(flat, "SPOTIFY_APP_PORT");
    if (!clientId || !clientSecret) return undefined;
    const port = portStr ? parseInt(portStr, 10) : 9999;
    return {
        clientId,
        clientSecret,
        port: Number.isFinite(port) ? port : 9999,
    };
}

function buildWikipedia(flat: Map<string, string>) {
    const clientId = popString(flat, "WIKIPEDIA_CLIENT_ID");
    const clientSecret = popString(flat, "WIKIPEDIA_CLIENT_SECRET");
    const endpoint = popString(flat, "WIKIPEDIA_ENDPOINT");
    if (!clientId && !clientSecret && !endpoint) return undefined;
    return {
        clientId: clientId ?? "",
        clientSecret: clientSecret ?? "",
        endpoint: endpoint ?? "",
    };
}

function buildStorage(flat: Map<string, string>) {
    const azureAccount = popString(flat, "AZURE_STORAGE_ACCOUNT");
    const azureContainer = popString(flat, "AZURE_STORAGE_CONTAINER");
    const cosmosDbConnectionString = popString(
        flat,
        "COSMOSDB_CONNECTION_STRING",
    );
    const mongoDbConnectionString = popString(
        flat,
        "MONGODB_CONNECTION_STRING",
    );
    const awsBucket = popString(flat, "AWS_S3_BUCKET_NAME");
    const awsRegion = popString(flat, "AWS_S3_REGION");
    const awsAccessKey = popString(flat, "AWS_ACCESS_KEY_ID");
    const awsSecret = popString(flat, "AWS_SECRET_ACCESS_KEY");

    const azure =
        azureAccount && azureContainer
            ? { account: azureAccount, container: azureContainer }
            : undefined;
    const aws =
        awsBucket && awsRegion && awsAccessKey && awsSecret
            ? {
                  bucketName: awsBucket,
                  region: awsRegion,
                  accessKeyId: awsAccessKey,
                  secretAccessKey: awsSecret,
              }
            : undefined;
    const database =
        cosmosDbConnectionString || mongoDbConnectionString
            ? {
                  ...(cosmosDbConnectionString !== undefined
                      ? { cosmosDbConnectionString }
                      : {}),
                  ...(mongoDbConnectionString !== undefined
                      ? { mongoDbConnectionString }
                      : {}),
              }
            : undefined;

    const elasticApiKey = popString(flat, "ELASTIC_API_KEY");
    const elasticUri = popString(flat, "ELASTIC_URI");
    const elastic =
        elasticApiKey && elasticUri
            ? { apiKey: elasticApiKey, uri: elasticUri }
            : undefined;

    return {
        ...(azure ? { azure } : {}),
        ...(aws ? { aws } : {}),
        ...(database ? { database } : {}),
        ...(elastic ? { elastic } : {}),
    };
}

function buildVault(flat: Map<string, string>) {
    const shared = popString(flat, "TYPEAGENT_SHAREDVAULT");
    if (!shared) return undefined;
    return { shared };
}

function buildAzureFoundry(flat: Map<string, string>) {
    const bingEndpoint = popString(flat, "BING_WITH_GROUNDING_ENDPOINT");
    const bingAgentId = popString(flat, "BING_WITH_GROUNDING_AGENT_ID");
    const bingUrlResolutionAgentId = popString(
        flat,
        "BING_WITH_GROUNDING_URL_RESOLUTION_AGENT_ID",
    );
    const bingUrlResolutionConnectionId = popString(
        flat,
        "BING_WITH_GROUNDING_URL_RESOLUTION_CONNECTION_ID",
    );
    const validatorAgentId = popString(
        flat,
        "AZURE_FOUNDRY_AGENT_ID_VALIDATOR",
    );
    const aliasKeywordExtractorAgentId = popString(
        flat,
        "AZURE_FOUNDRY_AGENT_ID_ALIAS_KEYWORD_EXTRACTOR",
    );
    const openPhraseGeneratorAgentId = popString(
        flat,
        "AZURE_FOUNDRY_AGENT_ID_OPEN_PHRASE_GENERATOR",
    );
    const httpEndpointLogicAppConnectionId = popString(
        flat,
        "LOGIC_APP_CONNECTION_ID_GET_HTTP_ENDPOINT",
    );
    const any =
        bingEndpoint ??
        bingAgentId ??
        bingUrlResolutionAgentId ??
        bingUrlResolutionConnectionId ??
        validatorAgentId ??
        aliasKeywordExtractorAgentId ??
        openPhraseGeneratorAgentId ??
        httpEndpointLogicAppConnectionId;
    if (any === undefined) return undefined;
    return {
        ...(bingEndpoint !== undefined ? { bingEndpoint } : {}),
        ...(bingAgentId !== undefined ? { bingAgentId } : {}),
        ...(bingUrlResolutionAgentId !== undefined
            ? { bingUrlResolutionAgentId }
            : {}),
        ...(bingUrlResolutionConnectionId !== undefined
            ? { bingUrlResolutionConnectionId }
            : {}),
        ...(validatorAgentId !== undefined ? { validatorAgentId } : {}),
        ...(aliasKeywordExtractorAgentId !== undefined
            ? { aliasKeywordExtractorAgentId }
            : {}),
        ...(openPhraseGeneratorAgentId !== undefined
            ? { openPhraseGeneratorAgentId }
            : {}),
        ...(httpEndpointLogicAppConnectionId !== undefined
            ? { httpEndpointLogicAppConnectionId }
            : {}),
    };
}

function buildReasoning(flat: Map<string, string>) {
    const timeoutRaw = popString(flat, "TYPEAGENT_REASONING_TIMEOUT_MS");
    const copilotModel = popString(flat, "COPILOT_REASONING_MODEL");
    if (timeoutRaw === undefined && copilotModel === undefined) return undefined;
    const timeoutMs =
        timeoutRaw !== undefined ? parseInt(timeoutRaw, 10) : undefined;
    return {
        ...(Number.isFinite(timeoutMs) ? { timeoutMs } : {}),
        ...(copilotModel !== undefined ? { copilotModel } : {}),
    };
}

// Re-exported helpers for tests / future builders.
export { parseSuffix };
