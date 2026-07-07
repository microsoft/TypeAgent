// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Bidirectional conversion between the typed `Config` and the
 * hierarchical YAML tree shape that the importer emits and that
 * `flatten()` understands.
 *
 *   buildConfig(flat) -> Config            (build.ts)
 *   configToTree(Config) -> ConfigTree     (this file, for YAML emit)
 *   treeToFlat(ConfigTree) -> FlatEnv      (this file, used by flatten())
 *
 * The YAML tree mirrors `Config` structurally: each section becomes a
 * top-level object whose keys match the typed field names. Maps
 * (deployments, endpoints) become plain objects keyed by their
 * canonical name / region. Auth that equals the section default is
 * omitted to keep the YAML readable; it is restored during flattening
 * by inheriting the section's `defaultAuth`.
 */

import type { ConfigTree, FlatEnv } from "../types.js";
import { regionFromUrl, regionToEnvSuffix } from "./regions.js";
import { buildConfig } from "./build.js";
import {
    AuthMode,
    Config,
    Deployment,
    DeploymentEndpoint,
    DeploymentMode,
    IDENTITY,
    authModeFromString,
} from "./types.js";

// ---------------------------------------------------------------------------
// configToTree: typed Config -> YAML-friendly object
// ---------------------------------------------------------------------------

function authToYaml(auth: AuthMode): string {
    return auth.kind === "identity" ? "identity" : auth.value;
}

function authEquals(a: AuthMode, b: AuthMode): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === "identity") return true;
    return a.value === (b as { kind: "key"; value: string }).value;
}

function endpointToYaml(
    ep: DeploymentEndpoint,
    sectionDefaultAuth: AuthMode,
    deploymentDefaultCapacity?: number,
): ConfigTree {
    const out: ConfigTree = { endpoint: ep.endpoint };
    if (!authEquals(ep.auth, sectionDefaultAuth)) {
        out.auth = authToYaml(ep.auth);
    }
    // Omit region when it can be auto-derived from the URL host.
    if (regionFromUrl(ep.endpoint) !== ep.region) {
        out.region = ep.region;
    }
    if (ep.mode === "PTU") out.mode = "PTU";
    // capacity emission: omit if it matches the deployment default,
    // emit `null` to opt out when the endpoint has no capacity but
    // a deployment default exists, otherwise emit the value.
    if (deploymentDefaultCapacity !== undefined) {
        if (ep.capacity === undefined) {
            out.capacity = null;
        } else if (ep.capacity !== deploymentDefaultCapacity) {
            out.capacity = ep.capacity;
        }
    } else if (ep.capacity !== undefined) {
        out.capacity = ep.capacity;
    }
    if (ep.tpm !== undefined) out.tpm = ep.tpm;
    // Only emit priority when it differs from the mode default
    // (PTU=1, PAYG=2). Keeps the YAML quiet for the common case.
    const defaultPriority = ep.mode === "PTU" ? 1 : 2;
    if (ep.priority !== defaultPriority) out.priority = ep.priority;
    return out;
}

/**
 * Pick the most-frequent defined capacity. Hoists when at least two
 * endpoints share the same value. Endpoints that don't share it (or
 * have none) are encoded explicitly via `capacity: <other>` or
 * `capacity: null` respectively, so round-trip is exact.
 */
function pickDefaultCapacity(
    vals: ReadonlyArray<number | undefined>,
): number | undefined {
    const counts = new Map<number, number>();
    for (const v of vals) {
        if (v === undefined) continue;
        counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    let best: number | undefined;
    let bestCount = 0;
    for (const [v, c] of counts) {
        if (c > bestCount) {
            best = v;
            bestCount = c;
        }
    }
    return bestCount >= 2 ? best : undefined;
}

/**
 * Find the highest-capacity endpoint among the `embedding` deployment's
 * endpoints in a raw YAML deployments node. Used to synthesize a default
 * bare embedding endpoint when `azureOpenAI.defaultEmbedding` is absent.
 */
function pickDefaultEmbeddingEndpoint(deploymentsNode: unknown):
    | {
          endpoint: string;
          auth?: AuthMode;
      }
    | undefined {
    if (deploymentsNode === null || typeof deploymentsNode !== "object") {
        return undefined;
    }
    const deployments = deploymentsNode as Record<string, unknown>;
    const node = deployments.embedding;
    if (node === undefined) return undefined;
    const arr: unknown = Array.isArray(node)
        ? node
        : typeof node === "object" && node !== null
          ? (node as Record<string, unknown>).endpoints
          : undefined;
    if (!Array.isArray(arr) || arr.length === 0) return undefined;
    let bestEndpoint: string | undefined;
    let bestAuth: AuthMode | undefined;
    let bestCapacity = -Infinity;
    for (let i = 0; i < arr.length; i++) {
        const item = arr[i];
        if (item === null || typeof item !== "object") continue;
        const o = item as Record<string, unknown>;
        const ep = o.endpoint;
        if (typeof ep !== "string") continue;
        const cap = typeof o.capacity === "number" ? o.capacity : (0 as number);
        if (cap > bestCapacity) {
            bestCapacity = cap;
            bestEndpoint = ep;
            bestAuth =
                o.auth !== undefined
                    ? readAuth(
                          o.auth,
                          `azureOpenAI.deployments.embedding[${i}].auth`,
                      )
                    : undefined;
        }
    }
    if (bestEndpoint === undefined) return undefined;
    return bestAuth !== undefined
        ? { endpoint: bestEndpoint, auth: bestAuth }
        : { endpoint: bestEndpoint };
}

function deploymentToYaml(
    d: Deployment,
    sectionDefaultAuth: AuthMode,
    sectionDefaultCapacity?: number,
): ConfigTree | ConfigTree[] {
    const deploymentDefault = pickDefaultCapacity(
        d.endpoints.map((e) => e.capacity),
    );
    // Use the deployment-level default for endpoint emission so that
    // endpoints matching it can be omitted. But only emit the
    // deployment-level key in YAML when it differs from the section
    // default — otherwise the section default already covers it.
    const effectiveDefault = deploymentDefault ?? sectionDefaultCapacity;
    const eps = d.endpoints.map((ep) =>
        endpointToYaml(ep, sectionDefaultAuth, effectiveDefault),
    );
    if (
        deploymentDefault !== undefined &&
        deploymentDefault !== sectionDefaultCapacity
    ) {
        return { defaultCapacity: deploymentDefault, endpoints: eps };
    }
    // If the deployment default matches the section default (or there
    // is none), a bare array suffices.
    if (effectiveDefault !== undefined && eps.length > 0) {
        // We still need the object form if any endpoint has
        // explicit capacity values (non-default) — but that's already
        // encoded inside each endpoint entry. Just wrap when we used
        // an effective default so that round-trip stays correct when
        // the section default covers the deployment.
    }
    return eps;
}

function bareEndpointToYaml(
    ep: DeploymentEndpoint,
    sectionDefaultAuth: AuthMode,
): ConfigTree {
    // Bare service endpoints (defaultEmbedding/defaultImage/defaultVideo)
    // synthesize a sentinel region; we omit region/mode/priority from
    // the YAML to keep them tidy, only emitting endpoint and (if
    // different) auth.
    const out: ConfigTree = { endpoint: ep.endpoint };
    if (!authEquals(ep.auth, sectionDefaultAuth)) {
        out.auth = authToYaml(ep.auth);
    }
    return out;
}

/**
 * Project a typed `Config` to a hierarchical YAML-friendly object.
 * The result is suitable for `js-yaml.dump`.
 */
export function configToTree(config: Config): ConfigTree {
    const tree: ConfigTree = {};
    const ao = config.azureOpenAI;
    const azure: ConfigTree = {
        defaultAuth: authToYaml(ao.defaultAuth),
        maxConcurrency: ao.maxConcurrency,
        maxTimeoutMs: ao.maxTimeoutMs,
        maxRetryAttempts: ao.maxRetryAttempts,
        responseFormat: ao.responseFormat,
    };
    if (ao.enableModelRequestLogging) {
        azure.enableModelRequestLogging = true;
    }
    if (ao.maxPromptChars !== undefined) {
        azure.maxPromptChars = ao.maxPromptChars;
    }
    if (ao.defaultChat) {
        azure.defaultChat = bareEndpointToYaml(ao.defaultChat, ao.defaultAuth);
    }
    if (ao.defaultEmbedding) {
        azure.defaultEmbedding = bareEndpointToYaml(
            ao.defaultEmbedding,
            ao.defaultAuth,
        );
    }
    if (ao.defaultImage) {
        azure.defaultImage = bareEndpointToYaml(
            ao.defaultImage,
            ao.defaultAuth,
        );
    }
    if (ao.defaultVideo) {
        azure.defaultVideo = bareEndpointToYaml(
            ao.defaultVideo,
            ao.defaultAuth,
        );
    }
    if (ao.deployments.size > 0) {
        // Derive section-level defaultCapacity: use the explicit value
        // from the Config, or pick the most frequent deployment-level
        // default across all deployments.
        let sectionDefaultCapacity = ao.defaultCapacity;
        if (sectionDefaultCapacity === undefined) {
            const depDefaults = [...ao.deployments.values()].map((d) =>
                pickDefaultCapacity(d.endpoints.map((e) => e.capacity)),
            );
            sectionDefaultCapacity = pickDefaultCapacity(depDefaults);
        }
        if (sectionDefaultCapacity !== undefined) {
            azure.defaultCapacity = sectionDefaultCapacity;
        }
        const deployments: ConfigTree = {};
        const sortedNames = [...ao.deployments.keys()].sort();
        for (const name of sortedNames) {
            const d = ao.deployments.get(name)!;
            deployments[name] = deploymentToYaml(
                d,
                ao.defaultAuth,
                sectionDefaultCapacity,
            );
        }
        azure.deployments = deployments;
    }
    tree.azureOpenAI = azure;

    if (config.openAI) {
        const o = config.openAI;
        const openAI: ConfigTree = {};
        // Emit main fields only when a real (non-synthetic) variant
        // is configured — a stub with empty apiKey means only `local`
        // is set and the main fields are noise.
        if (o.apiKey !== "") {
            openAI.apiKey = o.apiKey;
            if (o.endpoint !== undefined) openAI.endpoint = o.endpoint;
            if (o.endpointEmbedding !== undefined)
                openAI.endpointEmbedding = o.endpointEmbedding;
            if (o.model !== undefined) openAI.model = o.model;
            if (o.modelEmbedding !== undefined)
                openAI.modelEmbedding = o.modelEmbedding;
            if (o.organization !== undefined)
                openAI.organization = o.organization;
            openAI.responseFormat = o.responseFormat;
            openAI.maxConcurrency = o.maxConcurrency;
            openAI.maxTimeoutMs = o.maxTimeoutMs;
            openAI.maxRetryAttempts = o.maxRetryAttempts;
        }
        if (o.local) {
            const l = o.local;
            const local: ConfigTree = { apiKey: l.apiKey };
            if (l.endpoint !== undefined) local.endpoint = l.endpoint;
            if (l.endpointEmbedding !== undefined)
                local.endpointEmbedding = l.endpointEmbedding;
            if (l.model !== undefined) local.model = l.model;
            if (l.modelEmbedding !== undefined)
                local.modelEmbedding = l.modelEmbedding;
            if (l.organization !== undefined)
                local.organization = l.organization;
            // Only emit non-default tunables to keep YAML quiet.
            if (l.responseFormat) local.responseFormat = l.responseFormat;
            if (l.maxConcurrency !== 4) local.maxConcurrency = l.maxConcurrency;
            if (l.maxTimeoutMs !== 60_000) local.maxTimeoutMs = l.maxTimeoutMs;
            if (l.maxRetryAttempts !== 3)
                local.maxRetryAttempts = l.maxRetryAttempts;
            openAI.local = local;
        }
        if (Object.keys(openAI).length > 0) tree.openAI = openAI;
    }

    if (config.speech) {
        const s: ConfigTree = {
            auth: authToYaml(config.speech.auth),
            region: config.speech.region,
        };
        if (config.speech.endpoint !== undefined)
            s.endpoint = config.speech.endpoint;
        tree.speech = s;
    }

    if (config.maps) {
        tree.maps = {
            clientId: config.maps.clientId,
            endpoint: config.maps.endpoint,
        };
    }

    if (config.msGraph) {
        const m: ConfigTree = {
            clientId: config.msGraph.clientId,
            clientSecret: config.msGraph.clientSecret,
            tenantId: config.msGraph.tenantId,
        };
        if (config.msGraph.username !== undefined)
            m.username = config.msGraph.username;
        if (config.msGraph.password !== undefined)
            m.password = config.msGraph.password;
        tree.msGraph = m;
    }

    if (config.googleCalendar) {
        tree.googleCalendar = {
            clientId: config.googleCalendar.clientId,
            clientSecret: config.googleCalendar.clientSecret,
        };
    }

    if (config.spotify) {
        tree.spotify = {
            clientId: config.spotify.clientId,
            clientSecret: config.spotify.clientSecret,
            port: config.spotify.port,
        };
    }

    if (config.wikipedia) {
        const w: ConfigTree = {};
        if (config.wikipedia.clientId) w.clientId = config.wikipedia.clientId;
        if (config.wikipedia.clientSecret)
            w.clientSecret = config.wikipedia.clientSecret;
        if (config.wikipedia.endpoint) w.endpoint = config.wikipedia.endpoint;
        tree.wikipedia = w;
    }

    const storage: ConfigTree = {};
    if (config.storage.azure) {
        storage.azure = {
            account: config.storage.azure.account,
            container: config.storage.azure.container,
        };
    }
    if (config.storage.aws) {
        storage.aws = {
            bucketName: config.storage.aws.bucketName,
            region: config.storage.aws.region,
            accessKeyId: config.storage.aws.accessKeyId,
            secretAccessKey: config.storage.aws.secretAccessKey,
        };
    }
    if (config.storage.database) {
        const db: ConfigTree = {};
        if (config.storage.database.cosmosDbConnectionString !== undefined)
            db.cosmosDbConnectionString =
                config.storage.database.cosmosDbConnectionString;
        if (config.storage.database.mongoDbConnectionString !== undefined)
            db.mongoDbConnectionString =
                config.storage.database.mongoDbConnectionString;
        storage.database = db;
    }
    if (config.storage.elastic) {
        storage.elastic = {
            apiKey: config.storage.elastic.apiKey,
            uri: config.storage.elastic.uri,
        };
    }
    if (Object.keys(storage).length > 0) tree.storage = storage;

    if (config.vault?.shared) {
        tree.vault = { shared: config.vault.shared };
    }

    if (config.azureFoundry) {
        const f = config.azureFoundry;
        const af: ConfigTree = {};
        if (f.bingEndpoint !== undefined) af.bingEndpoint = f.bingEndpoint;
        if (f.bingAgentId !== undefined) af.bingAgentId = f.bingAgentId;
        if (f.bingUrlResolutionAgentId !== undefined)
            af.bingUrlResolutionAgentId = f.bingUrlResolutionAgentId;
        if (f.bingUrlResolutionConnectionId !== undefined)
            af.bingUrlResolutionConnectionId = f.bingUrlResolutionConnectionId;
        if (f.validatorAgentId !== undefined)
            af.validatorAgentId = f.validatorAgentId;
        if (f.aliasKeywordExtractorAgentId !== undefined)
            af.aliasKeywordExtractorAgentId = f.aliasKeywordExtractorAgentId;
        if (f.openPhraseGeneratorAgentId !== undefined)
            af.openPhraseGeneratorAgentId = f.openPhraseGeneratorAgentId;
        if (f.httpEndpointLogicAppConnectionId !== undefined)
            af.httpEndpointLogicAppConnectionId =
                f.httpEndpointLogicAppConnectionId;
        if (Object.keys(af).length > 0) tree.azureFoundry = af;
    }

    if (config.reasoning) {
        const r: ConfigTree = {};
        if (config.reasoning.timeoutMs !== undefined)
            r.timeoutMs = config.reasoning.timeoutMs;
        if (config.reasoning.copilotModel !== undefined)
            r.copilotModel = config.reasoning.copilotModel;
        if (Object.keys(r).length > 0) tree.reasoning = r;
    }

    if (config.modelProvider !== undefined) {
        tree.modelProvider = config.modelProvider;
    }

    if (config.copilot) {
        const c: ConfigTree = {};
        if (config.copilot.defaultModel !== undefined)
            c.defaultModel = config.copilot.defaultModel;
        if (config.copilot.cliPath !== undefined)
            c.cliPath = config.copilot.cliPath;
        if (config.copilot.cliUrl !== undefined)
            c.cliUrl = config.copilot.cliUrl;
        if (config.copilot.reasoningEffort !== undefined)
            c.reasoningEffort = config.copilot.reasoningEffort;
        if (config.copilot.disableInfiniteSessions !== undefined)
            c.disableInfiniteSessions = config.copilot.disableInfiniteSessions;
        if (config.copilot.maxConcurrency !== undefined)
            c.maxConcurrency = config.copilot.maxConcurrency;
        if (config.copilot.maxTimeoutMs !== undefined)
            c.maxTimeoutMs = config.copilot.maxTimeoutMs;
        if (config.copilot.maxRetryAttempts !== undefined)
            c.maxRetryAttempts = config.copilot.maxRetryAttempts;
        if (config.copilot.enableModelRequestLogging !== undefined)
            c.enableModelRequestLogging =
                config.copilot.enableModelRequestLogging;
        if (Object.keys(c).length > 0) tree.copilot = c;
    }

    if (config.embedding) {
        const e: ConfigTree = {};
        if (config.embedding.provider !== undefined)
            e.provider = config.embedding.provider;
        if (config.embedding.model !== undefined)
            e.model = config.embedding.model;
        if (config.embedding.cacheDir !== undefined)
            e.cacheDir = config.embedding.cacheDir;
        if (Object.keys(e).length > 0) tree.embedding = e;
    }

    return tree;
}

// ---------------------------------------------------------------------------
// typedSectionToFlat: YAML subtree -> flat env (used by flatten())
// ---------------------------------------------------------------------------

const TYPED_SECTION_KEYS = new Set([
    "azureOpenAI",
    "openAI",
    "speech",
    "maps",
    "msGraph",
    "googleCalendar",
    "spotify",
    "wikipedia",
    "storage",
    "vault",
    "azureFoundry",
    "reasoning",
    "copilot",
    "modelProvider",
    "embedding",
]);

export function isTypedSectionKey(key: string): boolean {
    return TYPED_SECTION_KEYS.has(key);
}

/**
 * Convenience wrapper: flat env vars → YAML-friendly tree.
 * Combines `buildConfig` and `configToTree` in one call.
 */
export function envToYamlTree(flat: FlatEnv): ConfigTree {
    return configToTree(buildConfig(flat));
}

function asObject(node: unknown, where: string): Record<string, unknown> {
    if (node === null || typeof node !== "object" || Array.isArray(node)) {
        throw new Error(
            `Expected an object at '${where}', got ${typeof node}.`,
        );
    }
    return node as Record<string, unknown>;
}

function asString(node: unknown, where: string): string {
    if (typeof node !== "string") {
        throw new Error(`Expected a string at '${where}', got ${typeof node}.`);
    }
    return node;
}

function asNumber(node: unknown, where: string): number {
    if (typeof node !== "number" || !Number.isFinite(node)) {
        throw new Error(
            `Expected a number at '${where}', got ${JSON.stringify(node)}.`,
        );
    }
    return node;
}

function readAuth(node: unknown, where: string): AuthMode {
    return authModeFromString(asString(node, where));
}

function readEndpointEntry(
    node: unknown,
    where: string,
): {
    endpoint: string;
    auth?: AuthMode;
    mode?: DeploymentMode;
    priority?: number;
    capacity?: number | null;
    region?: string;
    tpm?: number;
} {
    const obj = asObject(node, where);
    const out: ReturnType<typeof readEndpointEntry> = {
        endpoint: asString(obj.endpoint, `${where}.endpoint`),
    };
    if (obj.auth !== undefined) out.auth = readAuth(obj.auth, `${where}.auth`);
    if (obj.region !== undefined)
        out.region = asString(obj.region, `${where}.region`);
    if (obj.mode !== undefined) {
        const m = asString(obj.mode, `${where}.mode`).toUpperCase();
        if (m !== "PAYG" && m !== "PTU") {
            throw new Error(
                `Invalid mode at '${where}.mode': expected PAYG or PTU.`,
            );
        }
        out.mode = m;
    }
    if (obj.priority !== undefined)
        out.priority = asNumber(obj.priority, `${where}.priority`);
    // capacity may be a number, or explicitly `null` to opt out of
    // a deployment-level or section-level defaultCapacity. Missing means inherit.
    if (obj.capacity === null) {
        out.capacity = null;
    } else if (obj.capacity !== undefined) {
        out.capacity = asNumber(obj.capacity, `${where}.capacity`);
    }
    if (obj.tpm !== undefined) out.tpm = asNumber(obj.tpm, `${where}.tpm`);
    return out;
}

function emitAzureOpenAI(node: unknown, out: FlatEnv): void {
    const obj = asObject(node, "azureOpenAI");
    const defaultAuth: AuthMode =
        obj.defaultAuth !== undefined
            ? readAuth(obj.defaultAuth, "azureOpenAI.defaultAuth")
            : IDENTITY;
    out.AZURE_OPENAI_API_KEY = authToYaml(defaultAuth);

    if (obj.maxConcurrency !== undefined)
        out.AZURE_OPENAI_MAX_CONCURRENCY = String(
            asNumber(obj.maxConcurrency, "azureOpenAI.maxConcurrency"),
        );
    if (obj.maxTimeoutMs !== undefined)
        out.AZURE_OPENAI_MAX_TIMEOUT = String(
            asNumber(obj.maxTimeoutMs, "azureOpenAI.maxTimeoutMs"),
        );
    if (obj.maxRetryAttempts !== undefined)
        out.AZURE_OPENAI_MAX_RETRYATTEMPTS = String(
            asNumber(obj.maxRetryAttempts, "azureOpenAI.maxRetryAttempts"),
        );
    if (obj.responseFormat !== undefined)
        out.AZURE_OPENAI_RESPONSE_FORMAT = obj.responseFormat ? "1" : "0";
    if (obj.maxPromptChars !== undefined)
        out.AZURE_OPENAI_MAX_CHARS = String(
            asNumber(obj.maxPromptChars, "azureOpenAI.maxPromptChars"),
        );
    if (obj.enableModelRequestLogging)
        out.ENABLE_MODEL_REQUEST_LOGGING = "true";

    function emitBare(serviceName: string, suffix: string | null): void {
        if (obj[serviceName] === undefined) return;
        const where = `azureOpenAI.${serviceName}`;
        const o = asObject(obj[serviceName], where);
        const ep = asString(o.endpoint, `${where}.endpoint`);
        const auth =
            o.auth !== undefined
                ? readAuth(o.auth, `${where}.auth`)
                : defaultAuth;
        if (suffix === null) {
            out.AZURE_OPENAI_ENDPOINT = ep;
        } else {
            out[`AZURE_OPENAI_ENDPOINT_${suffix}`] = ep;
            out[`AZURE_OPENAI_API_KEY_${suffix}`] = authToYaml(auth);
        }
    }
    emitBare("defaultChat", null);
    emitBare("defaultEmbedding", "EMBEDDING");
    emitBare("defaultImage", "GPT_IMAGE_1_5");
    emitBare("defaultVideo", "SORA_2");

    // Auto-synthesize the bare embedding endpoint from the highest-capacity
    // `embedding` deployment endpoint when no explicit `defaultEmbedding` is
    // configured. This lets callers that look up the bare
    // AZURE_OPENAI_ENDPOINT_EMBEDDING env var (legacy path) succeed without
    // requiring users to repeat the endpoint in `defaultEmbedding:`.
    if (out.AZURE_OPENAI_ENDPOINT_EMBEDDING === undefined) {
        const auto = pickDefaultEmbeddingEndpoint(obj.deployments);
        if (auto !== undefined) {
            out.AZURE_OPENAI_ENDPOINT_EMBEDDING = auto.endpoint;
            out.AZURE_OPENAI_API_KEY_EMBEDDING = authToYaml(
                auto.auth ?? defaultAuth,
            );
        }
    }

    // Section-level defaultCapacity — inherited by all deployments
    // that don't specify their own.
    let sectionDefaultCapacity: number | undefined;
    if (obj.defaultCapacity !== undefined)
        sectionDefaultCapacity = asNumber(
            obj.defaultCapacity,
            "azureOpenAI.defaultCapacity",
        );

    if (obj.deployments !== undefined) {
        const dmap = asObject(obj.deployments, "azureOpenAI.deployments");
        for (const [name, dnode] of Object.entries(dmap)) {
            const where = `azureOpenAI.deployments.${name}`;
            // Two accepted shapes:
            //   - array of endpoints (no per-deployment defaults)
            //   - object: { defaultCapacity?, endpoints: [...] }
            let endpointsNode: unknown;
            let defaultCapacity: number | undefined;
            if (Array.isArray(dnode)) {
                endpointsNode = dnode;
            } else {
                const dobj = asObject(dnode, where);
                if (dobj.defaultCapacity !== undefined)
                    defaultCapacity = asNumber(
                        dobj.defaultCapacity,
                        `${where}.defaultCapacity`,
                    );
                endpointsNode = dobj.endpoints;
                if (!Array.isArray(endpointsNode)) {
                    throw new Error(
                        `Expected an array at '${where}.endpoints'.`,
                    );
                }
            }
            // Fall back to section-level defaultCapacity when the
            // deployment doesn't specify its own.
            if (defaultCapacity === undefined)
                defaultCapacity = sectionDefaultCapacity;
            const arr = endpointsNode as unknown[];
            const upperName = name.toUpperCase();
            const overrides: Array<Record<string, unknown>> = [];
            for (let i = 0; i < arr.length; i++) {
                const ewhere = `${where}[${i}]`;
                const ep = readEndpointEntry(arr[i], ewhere);
                // Resolve effective capacity:
                //   - explicit number     -> use it
                //   - explicit null       -> no capacity (opt out)
                //   - missing & default   -> inherit deployment or section defaultCapacity
                //   - missing & no default-> no capacity
                let capacity: number | undefined;
                if (typeof ep.capacity === "number") {
                    capacity = ep.capacity;
                } else if (ep.capacity === null) {
                    capacity = undefined;
                } else {
                    capacity = defaultCapacity;
                }
                const region = ep.region ?? regionFromUrl(ep.endpoint);
                if (!region) {
                    throw new Error(
                        `Could not derive region for ${ewhere}; ` +
                            `add a 'region:' property.`,
                    );
                }
                const mode = ep.mode ?? "PAYG";
                const regionToken = regionToEnvSuffix(region as never);
                const suffix =
                    mode === "PTU"
                        ? `${upperName}_${regionToken}_PTU`
                        : `${upperName}_${regionToken}`;
                out[`AZURE_OPENAI_ENDPOINT_${suffix}`] = ep.endpoint;
                out[`AZURE_OPENAI_API_KEY_${suffix}`] = authToYaml(
                    ep.auth ?? defaultAuth,
                );
                const defPriority = mode === "PTU" ? 1 : 2;
                const priority = ep.priority ?? defPriority;
                if (
                    capacity !== undefined ||
                    ep.tpm !== undefined ||
                    priority !== defPriority
                ) {
                    const o: Record<string, unknown> = {
                        suffix,
                        region,
                        mode,
                    };
                    if (capacity !== undefined) o.capacity = capacity;
                    if (ep.tpm !== undefined) o.tpm = ep.tpm;
                    o.priority = priority;
                    overrides.push(o);
                }
            }
            if (overrides.length > 0) {
                const body = overrides
                    .map(
                        (o) =>
                            "{" +
                            Object.entries(o)
                                .map(([k, v]) => `${k}:${v}`)
                                .join(",") +
                            "}",
                    )
                    .join(",");
                out[`AZURE_OPENAI_POOL_${upperName}`] = `[${body}]`;
            }
        }
    }
}

function emitOpenAI(node: unknown, out: FlatEnv): void {
    const o = asObject(node, "openAI");
    emitOpenAIVariant(o, out, "", "openAI");
    if (o.local !== undefined) {
        const lo = asObject(o.local, "openAI.local");
        emitOpenAIVariant(lo, out, "_LOCAL", "openAI.local");
        // Emit OLLAMA_ENDPOINT alias so consumers reading that legacy
        // env var pick up the openAI.local endpoint automatically.
        if (lo.endpoint !== undefined)
            out.OLLAMA_ENDPOINT = asString(
                lo.endpoint,
                "openAI.local.endpoint",
            );
    }
}

function emitOpenAIVariant(
    o: Record<string, unknown>,
    out: FlatEnv,
    suffix: string,
    where: string,
): void {
    if (o.apiKey !== undefined)
        out[`OPENAI_API_KEY${suffix}`] = asString(o.apiKey, `${where}.apiKey`);
    if (o.endpoint !== undefined)
        out[`OPENAI_ENDPOINT${suffix}`] = asString(
            o.endpoint,
            `${where}.endpoint`,
        );
    if (o.endpointEmbedding !== undefined)
        out[`OPENAI_ENDPOINT_EMBEDDING${suffix}`] = asString(
            o.endpointEmbedding,
            `${where}.endpointEmbedding`,
        );
    if (o.model !== undefined)
        out[`OPENAI_MODEL${suffix}`] = asString(o.model, `${where}.model`);
    if (o.modelEmbedding !== undefined)
        out[`OPENAI_MODEL_EMBEDDING${suffix}`] = asString(
            o.modelEmbedding,
            `${where}.modelEmbedding`,
        );
    if (o.organization !== undefined)
        out[`OPENAI_ORGANIZATION${suffix}`] = asString(
            o.organization,
            `${where}.organization`,
        );
    if (o.responseFormat !== undefined)
        out[`OPENAI_RESPONSE_FORMAT${suffix}`] = o.responseFormat ? "1" : "0";
    if (o.maxConcurrency !== undefined)
        out[`OPENAI_MAX_CONCURRENCY${suffix}`] = String(
            asNumber(o.maxConcurrency, `${where}.maxConcurrency`),
        );
    if (o.maxTimeoutMs !== undefined)
        out[`OPENAI_MAX_TIMEOUT${suffix}`] = String(
            asNumber(o.maxTimeoutMs, `${where}.maxTimeoutMs`),
        );
    if (o.maxRetryAttempts !== undefined)
        out[`OPENAI_MAX_RETRYATTEMPTS${suffix}`] = String(
            asNumber(o.maxRetryAttempts, `${where}.maxRetryAttempts`),
        );
}

function emitSpeech(node: unknown, out: FlatEnv): void {
    const s = asObject(node, "speech");
    if (s.auth !== undefined)
        out.SPEECH_SDK_KEY = authToYaml(readAuth(s.auth, "speech.auth"));
    if (s.region !== undefined)
        out.SPEECH_SDK_REGION = asString(s.region, "speech.region");
    if (s.endpoint !== undefined)
        out.SPEECH_SDK_ENDPOINT = asString(s.endpoint, "speech.endpoint");
}

function emitMaps(node: unknown, out: FlatEnv): void {
    const m = asObject(node, "maps");
    if (m.clientId !== undefined)
        out.AZURE_MAPS_CLIENTID = asString(m.clientId, "maps.clientId");
    if (m.endpoint !== undefined)
        out.AZURE_MAPS_ENDPOINT = asString(m.endpoint, "maps.endpoint");
}

function emitMsGraph(node: unknown, out: FlatEnv): void {
    const m = asObject(node, "msGraph");
    if (m.clientId !== undefined)
        out.MSGRAPH_APP_CLIENTID = asString(m.clientId, "msGraph.clientId");
    if (m.clientSecret !== undefined)
        out.MSGRAPH_APP_CLIENTSECRET = asString(
            m.clientSecret,
            "msGraph.clientSecret",
        );
    if (m.tenantId !== undefined)
        out.MSGRAPH_APP_TENANTID = asString(m.tenantId, "msGraph.tenantId");
    if (m.username !== undefined)
        out.MSGRAPH_APP_USERNAME = asString(m.username, "msGraph.username");
    if (m.password !== undefined)
        out.MSGRAPH_APP_PASSWD = asString(m.password, "msGraph.password");
}

function emitGoogleCalendar(node: unknown, out: FlatEnv): void {
    const g = asObject(node, "googleCalendar");
    if (g.clientId !== undefined)
        out.GOOGLE_CALENDAR_CLIENT_ID = asString(
            g.clientId,
            "googleCalendar.clientId",
        );
    if (g.clientSecret !== undefined)
        out.GOOGLE_CALENDAR_CLIENT_SECRET = asString(
            g.clientSecret,
            "googleCalendar.clientSecret",
        );
}

function emitSpotify(node: unknown, out: FlatEnv): void {
    const s = asObject(node, "spotify");
    if (s.clientId !== undefined)
        out.SPOTIFY_APP_CLI = asString(s.clientId, "spotify.clientId");
    if (s.clientSecret !== undefined)
        out.SPOTIFY_APP_CLISEC = asString(
            s.clientSecret,
            "spotify.clientSecret",
        );
    if (s.port !== undefined)
        out.SPOTIFY_APP_PORT = String(asNumber(s.port, "spotify.port"));
}

function emitWikipedia(node: unknown, out: FlatEnv): void {
    const w = asObject(node, "wikipedia");
    if (w.clientId !== undefined)
        out.WIKIPEDIA_CLIENT_ID = asString(w.clientId, "wikipedia.clientId");
    if (w.clientSecret !== undefined)
        out.WIKIPEDIA_CLIENT_SECRET = asString(
            w.clientSecret,
            "wikipedia.clientSecret",
        );
    if (w.endpoint !== undefined)
        out.WIKIPEDIA_ENDPOINT = asString(w.endpoint, "wikipedia.endpoint");
}

function emitStorage(node: unknown, out: FlatEnv): void {
    const s = asObject(node, "storage");
    if (s.azure !== undefined) {
        const a = asObject(s.azure, "storage.azure");
        if (a.account !== undefined)
            out.AZURE_STORAGE_ACCOUNT = asString(
                a.account,
                "storage.azure.account",
            );
        if (a.container !== undefined)
            out.AZURE_STORAGE_CONTAINER = asString(
                a.container,
                "storage.azure.container",
            );
    }
    if (s.aws !== undefined) {
        const a = asObject(s.aws, "storage.aws");
        if (a.bucketName !== undefined)
            out.AWS_S3_BUCKET_NAME = asString(
                a.bucketName,
                "storage.aws.bucketName",
            );
        if (a.region !== undefined)
            out.AWS_S3_REGION = asString(a.region, "storage.aws.region");
        if (a.accessKeyId !== undefined)
            out.AWS_ACCESS_KEY_ID = asString(
                a.accessKeyId,
                "storage.aws.accessKeyId",
            );
        if (a.secretAccessKey !== undefined)
            out.AWS_SECRET_ACCESS_KEY = asString(
                a.secretAccessKey,
                "storage.aws.secretAccessKey",
            );
    }
    if (s.database !== undefined) {
        const d = asObject(s.database, "storage.database");
        if (d.cosmosDbConnectionString !== undefined)
            out.COSMOSDB_CONNECTION_STRING = asString(
                d.cosmosDbConnectionString,
                "storage.database.cosmosDbConnectionString",
            );
        if (d.mongoDbConnectionString !== undefined)
            out.MONGODB_CONNECTION_STRING = asString(
                d.mongoDbConnectionString,
                "storage.database.mongoDbConnectionString",
            );
    }
    if (s.elastic !== undefined) {
        const e = asObject(s.elastic, "storage.elastic");
        if (e.apiKey !== undefined)
            out.ELASTIC_API_KEY = asString(e.apiKey, "storage.elastic.apiKey");
        if (e.uri !== undefined)
            out.ELASTIC_URI = asString(e.uri, "storage.elastic.uri");
    }
}

function emitVault(node: unknown, out: FlatEnv): void {
    const v = asObject(node, "vault");
    if (v.shared !== undefined)
        out.TYPEAGENT_SHAREDVAULT = asString(v.shared, "vault.shared");
}

function emitAzureFoundry(node: unknown, out: FlatEnv): void {
    const f = asObject(node, "azureFoundry");
    const map: Array<[string, string]> = [
        ["bingEndpoint", "BING_WITH_GROUNDING_ENDPOINT"],
        ["bingAgentId", "BING_WITH_GROUNDING_AGENT_ID"],
        [
            "bingUrlResolutionAgentId",
            "BING_WITH_GROUNDING_URL_RESOLUTION_AGENT_ID",
        ],
        [
            "bingUrlResolutionConnectionId",
            "BING_WITH_GROUNDING_URL_RESOLUTION_CONNECTION_ID",
        ],
        ["validatorAgentId", "AZURE_FOUNDRY_AGENT_ID_VALIDATOR"],
        [
            "aliasKeywordExtractorAgentId",
            "AZURE_FOUNDRY_AGENT_ID_ALIAS_KEYWORD_EXTRACTOR",
        ],
        [
            "openPhraseGeneratorAgentId",
            "AZURE_FOUNDRY_AGENT_ID_OPEN_PHRASE_GENERATOR",
        ],
        [
            "httpEndpointLogicAppConnectionId",
            "LOGIC_APP_CONNECTION_ID_GET_HTTP_ENDPOINT",
        ],
    ];
    for (const [yamlKey, envKey] of map) {
        if (f[yamlKey] !== undefined)
            out[envKey] = asString(f[yamlKey], `azureFoundry.${yamlKey}`);
    }
}

function emitModelProvider(node: unknown, out: FlatEnv): void {
    if (typeof node !== "string") {
        throw new Error(
            `Expected a string at 'modelProvider', got ${typeof node}.`,
        );
    }
    out.TYPEAGENT_MODEL_PROVIDER = node;
}

function emitEmbedding(node: unknown, out: FlatEnv): void {
    const e = asObject(node, "embedding");
    if (e.provider !== undefined)
        out.TYPEAGENT_EMBEDDING_PROVIDER = asString(
            e.provider,
            "embedding.provider",
        );
    if (e.model !== undefined)
        out.TYPEAGENT_EMBEDDING_MODEL = asString(e.model, "embedding.model");
    if (e.cacheDir !== undefined)
        out.TYPEAGENT_EMBEDDING_CACHE_DIR = asString(
            e.cacheDir,
            "embedding.cacheDir",
        );
}

function emitCopilot(node: unknown, out: FlatEnv): void {
    const c = asObject(node, "copilot");
    if (c.defaultModel !== undefined)
        out.COPILOT_DEFAULT_MODEL = asString(
            c.defaultModel,
            "copilot.defaultModel",
        );
    if (c.cliPath !== undefined)
        out.COPILOT_CLI_PATH = asString(c.cliPath, "copilot.cliPath");
    if (c.cliUrl !== undefined)
        out.COPILOT_CLI_URL = asString(c.cliUrl, "copilot.cliUrl");
    if (c.reasoningEffort !== undefined)
        out.COPILOT_REASONING_EFFORT = asString(
            c.reasoningEffort,
            "copilot.reasoningEffort",
        );
    if (c.disableInfiniteSessions !== undefined)
        out.COPILOT_DISABLE_INFINITE_SESSIONS = c.disableInfiniteSessions
            ? "1"
            : "0";
    if (c.maxConcurrency !== undefined)
        out.COPILOT_MAX_CONCURRENCY = String(
            asNumber(c.maxConcurrency, "copilot.maxConcurrency"),
        );
    if (c.maxTimeoutMs !== undefined)
        out.COPILOT_MAX_TIMEOUT = String(
            asNumber(c.maxTimeoutMs, "copilot.maxTimeoutMs"),
        );
    if (c.maxRetryAttempts !== undefined)
        out.COPILOT_MAX_RETRYATTEMPTS = String(
            asNumber(c.maxRetryAttempts, "copilot.maxRetryAttempts"),
        );
    if (c.enableModelRequestLogging !== undefined)
        out.COPILOT_ENABLE_LOGGING = c.enableModelRequestLogging ? "1" : "0";
}

function emitReasoning(node: unknown, out: FlatEnv): void {
    const r = asObject(node, "reasoning");
    if (r.timeoutMs !== undefined)
        out.TYPEAGENT_REASONING_TIMEOUT_MS = String(
            asNumber(r.timeoutMs, "reasoning.timeoutMs"),
        );
    if (r.copilotModel !== undefined)
        out.COPILOT_REASONING_MODEL = asString(
            r.copilotModel,
            "reasoning.copilotModel",
        );
}

/**
 * Project a typed top-level subtree (e.g. `azureOpenAI`, `openAI`,
 * `speech`, ...) onto its flat env-var equivalents, mirroring
 * `configToEnv` but operating on the YAML object form (no Map types,
 * regions as object keys).
 */
export function typedSectionToFlat(key: string, node: unknown): FlatEnv {
    const out: FlatEnv = {};
    switch (key) {
        case "azureOpenAI":
            emitAzureOpenAI(node, out);
            break;
        case "openAI":
            emitOpenAI(node, out);
            break;
        case "speech":
            emitSpeech(node, out);
            break;
        case "maps":
            emitMaps(node, out);
            break;
        case "msGraph":
            emitMsGraph(node, out);
            break;
        case "googleCalendar":
            emitGoogleCalendar(node, out);
            break;
        case "spotify":
            emitSpotify(node, out);
            break;
        case "wikipedia":
            emitWikipedia(node, out);
            break;
        case "storage":
            emitStorage(node, out);
            break;
        case "vault":
            emitVault(node, out);
            break;
        case "azureFoundry":
            emitAzureFoundry(node, out);
            break;
        case "reasoning":
            emitReasoning(node, out);
            break;
        case "copilot":
            emitCopilot(node, out);
            break;
        case "modelProvider":
            emitModelProvider(node, out);
            break;
        case "embedding":
            emitEmbedding(node, out);
            break;
        default:
            throw new Error(`Not a typed section: '${key}'.`);
    }
    return out;
}
