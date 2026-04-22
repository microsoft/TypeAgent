// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import { priorityQueue } from "async";
import { azureApiSettingsFromEnv } from "./azureSettings.js";
import { openAIApiSettingsFromEnv } from "./openaiSettings.js";
import { ApiSettings, EnvVars, ModelProviders, ModelType } from "./openai.js";
import { FetchThrottler } from "./restClient.js";

const debugPool = registerDebug("typeagent:pool");

export type EndpointMode = "PTU" | "PAYG" | "unknown";

/**
 * One member of an endpoint pool. Owns the settings (endpoint URL, key,
 * throttler) plus mutable runtime state (cooldown after a 429, success/fail
 * counters for cooldown decay).
 */
export type EndpointPoolMember = {
    // Full env-var suffix used to hydrate settings, e.g. "GPT_4_O_EASTUS_PTU".
    // Empty string for the legacy bare-endpoint case.
    suffix: string;
    // Region token extracted from the tail (lowercase), for logs only.
    region?: string | undefined;
    // 1 = preferred tier; 2+ = fallback tiers.
    priority: number;
    mode: EndpointMode;
    declaredTpm?: number | undefined;
    settings: ApiSettings;

    // runtime state (mutable)
    cooldownUntil: number;
    consecutive429s: number;
    consecutiveSuccesses: number;
};

export type EndpointPool = {
    modelKey: string;
    members: EndpointPoolMember[];
};

type PoolOverrideEntry = {
    suffix?: string;
    priority?: number;
    mode?: EndpointMode;
    tpm?: number;
};

// Known Azure region tokens. Used to recognise the REGION portion of a tail
// so we can strip a trailing _PTU variant and log a sensible region. This list
// is informational — an unknown token just becomes the "region" value as-is
// and the pool still works.
const KNOWN_REGIONS = new Set(
    [
        "eastus",
        "eastus2",
        "westus",
        "westus2",
        "westus3",
        "centralus",
        "northcentralus",
        "southcentralus",
        "westcentralus",
        "swedencentral",
        "francecentral",
        "germanywestcentral",
        "norwayeast",
        "northeurope",
        "westeurope",
        "uksouth",
        "ukwest",
        "switzerlandnorth",
        "japaneast",
        "japanwest",
        "australiaeast",
        "koreacentral",
        "southeastasia",
        "eastasia",
        "centralindia",
        "southindia",
        "brazilsouth",
        "canadacentral",
        "canadaeast",
        // short aliases people commonly put in env-var names
        "sweden",
        "japan",
        "australia",
        "brazil",
        "canada",
        "korea",
        "uk",
    ].map((s) => s.toLowerCase()),
);

// cooldown tuning
const BASE_COOLDOWN_MS = 2_000;
const MAX_COOLDOWN_MS = 120_000;
const TRANSIENT_FLOOR_COOLDOWN_MS = 5_000;
const SUCCESS_STREAK_TO_RESET = 3;

export function getEndpointRootEnvVar(
    provider: ModelProviders,
    modelType: ModelType,
): string {
    if (provider === "openai") {
        return modelType === ModelType.Chat
            ? EnvVars.OPENAI_ENDPOINT
            : EnvVars.OPENAI_ENDPOINT_EMBEDDING;
    }
    switch (modelType) {
        case ModelType.Chat:
            return EnvVars.AZURE_OPENAI_ENDPOINT;
        case ModelType.Embedding:
            return EnvVars.AZURE_OPENAI_ENDPOINT_EMBEDDING;
        case ModelType.Image:
            return EnvVars.AZURE_OPENAI_ENDPOINT_GPT_IMAGE_1_5;
        case ModelType.Video:
            return EnvVars.AZURE_OPENAI_ENDPOINT_SORA_2;
    }
}

function extractRegionAndMode(tail: string): {
    region?: string;
    mode: EndpointMode;
} {
    if (tail.length === 0) {
        return { mode: "unknown" };
    }
    const tokens = tail.split("_").filter((t) => t.length > 0);
    let mode: EndpointMode = "PAYG";
    // trailing _PTU variant marker
    if (
        tokens.length > 0 &&
        tokens[tokens.length - 1].toUpperCase() === "PTU"
    ) {
        mode = "PTU";
        tokens.pop();
    }
    if (tokens.length === 0) {
        return { mode };
    }
    const candidate = tokens.join("").toLowerCase();
    const region = KNOWN_REGIONS.has(candidate) ? candidate : candidate;
    return { region, mode };
}

// Does the given tail (the suffix *after* the model name) parse as a
// [region]? + [_PTU]? sequence? Used to distinguish "regional variant of this
// pool" from "member of a different, longer-named pool that happens to share
// the same prefix".
//
// Examples (for a pool whose basePrefix is AZURE_OPENAI_ENDPOINT_EMBEDDING):
//   tail="EASTUS"                  → valid (region)
//   tail="EASTUS_PTU"              → valid (region + PTU)
//   tail="INDEXING_WESTUS"         → valid (deployment-tag + region);
//                                    accepted because the tag is non-region
//                                    but the final tokens still resolve to a
//                                    known region — this is the tagged-variant
//                                    case (ada-002-indexing in westus).
//   tail="3_LARGE_EASTUS"          → INVALID for the EMBEDDING pool — the
//                                    "3_LARGE" prefix marks a different
//                                    model (text-embedding-3-large). Caller
//                                    must request that model by name.
//
// The rule: the trailing tokens (after stripping optional _PTU) must
// concatenate to a known-region token. Anything before that is treated as a
// deployment tag (fine) or as evidence of a different model (reject).
function tailLooksLikeRegionSuffix(tail: string): boolean {
    if (tail.length === 0) return true; // bare suffix — pool-of-one base
    const tokens = tail.split("_").filter((t) => t.length > 0);
    if (tokens.length === 0) return true;
    if (tokens[tokens.length - 1].toUpperCase() === "PTU") tokens.pop();
    if (tokens.length === 0) return true;
    // All remaining tokens must combine to a known region. Leaving any
    // non-region prefix token (e.g. "3_LARGE" in "3_LARGE_EASTUS") means
    // the suffix belongs to a different, longer-named pool. Regions are at
    // most 3 tokens when split by "_" (e.g. NORTH_CENTRAL_US).
    if (tokens.length > 3) return false;
    const candidate = tokens.join("").toLowerCase();
    return KNOWN_REGIONS.has(candidate);
}

function scanSuffixes(
    env: Record<string, string | undefined>,
    root: string,
    basePrefix: string,
): string[] {
    // Collect distinct tails. A tail is the portion of the endpoint env-var
    // key after basePrefix (plus the optional "_" separator). The empty tail
    // represents the bare basePrefix env-var.
    const suffixes = new Set<string>();

    for (const key of Object.keys(env)) {
        if (key === basePrefix) {
            // Use empty string for the tail, but the "endpointName" we pass
            // to settings hydration is whatever comes after `root` in the
            // bare-suffix case. For root==basePrefix (default model) this is
            // empty; for named models (basePrefix = root + "_" + endpointName)
            // it's endpointName.
            suffixes.add(
                basePrefix === root ? "" : basePrefix.slice(root.length + 1),
            );
            continue;
        }
        if (!key.startsWith(basePrefix + "_")) {
            continue;
        }
        // key == "<basePrefix>_<tail>". Suffix relative to root is everything
        // after root + "_".
        if (basePrefix === root) {
            suffixes.add(key.slice(root.length + 1));
        } else {
            suffixes.add(key.slice(root.length + 1));
        }
    }
    return [...suffixes];
}

function readPoolOverride(
    env: Record<string, string | undefined>,
    endpointName: string | undefined,
): PoolOverrideEntry[] | undefined {
    if (!endpointName) return undefined;
    const overrideKey = `AZURE_OPENAI_POOL_${endpointName}`;
    const raw = env[overrideKey];
    if (!raw) return undefined;
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            debugPool(
                `ignoring ${overrideKey}: expected JSON array, got ${typeof parsed}`,
            );
            return undefined;
        }
        return parsed.filter((e) => e && typeof e === "object");
    } catch (e: any) {
        debugPool(`ignoring ${overrideKey}: invalid JSON (${e?.message})`);
        return undefined;
    }
}

function makeThrottler(maxConcurrency: number): FetchThrottler {
    const q = priorityQueue<() => Promise<any>>(
        async (task) => task(),
        maxConcurrency,
    );
    return (fn: () => Promise<any>) => q.push<any>(fn);
}

/**
 * Build a pool with a single member from a pre-built ApiSettings. Used when
 * callers pass settings directly to createChatModel / createEmbeddingModel.
 */
export function makeSingleMemberPool(
    settings: ApiSettings,
    modelKey: string,
): EndpointPool {
    return {
        modelKey,
        members: [
            {
                suffix: "",
                priority: 1,
                mode: "unknown",
                settings,
                cooldownUntil: 0,
                consecutive429s: 0,
                consecutiveSuccesses: 0,
            },
        ],
    };
}

/**
 * Discover the pool of endpoints for (provider, modelType, endpointName) by
 * scanning env vars that match the expected prefix. Falls back to a one-member
 * pool (existing behavior) when no regional variants are found.
 */
export function discoverEndpointPool(
    provider: ModelProviders,
    modelType: ModelType,
    endpointName?: string,
    env?: Record<string, string | undefined>,
): EndpointPool {
    env ??= process.env;

    // Ollama doesn't do pooling — single endpoint always.
    if (provider === "ollama") {
        throw new Error(
            "discoverEndpointPool is not applicable to ollama provider",
        );
    }

    const root = getEndpointRootEnvVar(provider, modelType);
    const basePrefix = endpointName ? `${root}_${endpointName}` : root;

    // For the default chat case (no endpointName, Chat modelType) we avoid
    // scanning — the bare AZURE_OPENAI_ENDPOINT prefix would accidentally
    // match AZURE_OPENAI_ENDPOINT_GPT_4_O, etc. Just build a one-member pool
    // from the bare env var. Same for default OpenAI chat.
    // Embeddings/Image/Video have distinct root prefixes, so scanning is safe
    // there even without an endpointName.
    const safeToScan =
        endpointName !== undefined || modelType !== ModelType.Chat;

    let suffixes: string[] = [];
    if (safeToScan) {
        suffixes = scanSuffixes(env, root, basePrefix);
    }
    if (suffixes.length === 0) {
        // Fallback to a single member using the caller-supplied endpointName
        // (which may be undefined → bare root). This preserves legacy behavior.
        suffixes = [endpointName ?? ""];
    }

    const hydrate =
        provider === "openai"
            ? openAIApiSettingsFromEnv
            : azureApiSettingsFromEnv;

    const overrides = readPoolOverride(env, endpointName);
    const overrideBySuffix = new Map<string, PoolOverrideEntry>();
    if (overrides) {
        for (const entry of overrides) {
            if (entry.suffix) {
                overrideBySuffix.set(entry.suffix, entry);
            }
        }
    }

    const members: EndpointPoolMember[] = [];
    let lastHydrateError: Error | undefined;
    for (const suffix of suffixes) {
        let settings: ApiSettings;
        try {
            settings = hydrate(
                modelType,
                env,
                suffix === "" ? undefined : suffix,
            );
        } catch (e: any) {
            // Missing env var for this suffix — skip the member. This can
            // happen when AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS exists but
            // AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS doesn't (and no fallback
            // identity-mode key is set at the base).
            debugPool(
                `skipping pool member "${suffix}" for ${provider}:${endpointName ?? ""}: ${e?.message}`,
            );
            lastHydrateError = e;
            continue;
        }

        // Attach a per-endpoint throttler if maxConcurrency is set.
        if (
            settings.maxConcurrency !== undefined &&
            settings.throttler === undefined
        ) {
            settings.throttler = makeThrottler(settings.maxConcurrency);
        }

        // Determine the tail (portion of suffix after the model name) for
        // region/mode extraction.
        let tail = "";
        if (endpointName && suffix.startsWith(endpointName)) {
            tail = suffix.slice(endpointName.length);
            if (tail.startsWith("_")) tail = tail.slice(1);
        } else if (!endpointName) {
            tail = suffix; // for embeddings/image default case, suffix == tail
        }

        // Guard against prefix-collision: if the tail doesn't look like a
        // [region][_PTU] pattern (e.g., tail="3_LARGE_EASTUS" on the
        // EMBEDDING pool), this env var belongs to a *different* model that
        // happens to share the same prefix. Skip it here; the correct pool
        // for that model will pick it up when the caller requests it by
        // name (e.g. createEmbeddingModel("EMBEDDING_3_LARGE")).
        if (
            suffix !== (endpointName ?? "") &&
            !tailLooksLikeRegionSuffix(tail)
        ) {
            debugPool(
                `skipping ${provider} ${endpointName ?? "<bare>"} member "${suffix}": tail "${tail}" doesn't look like a region — belongs to a different model`,
            );
            continue;
        }

        const { region, mode: defaultMode } = extractRegionAndMode(tail);

        // Default priority: bare suffix or PTU variants are tier 1, else tier 2.
        const defaultPriority =
            suffix === endpointName || suffix === ""
                ? 1
                : defaultMode === "PTU"
                  ? 1
                  : 2;

        const override = overrideBySuffix.get(suffix);

        members.push({
            suffix,
            region,
            priority: override?.priority ?? defaultPriority,
            mode: override?.mode ?? defaultMode,
            declaredTpm: override?.tpm,
            settings,
            cooldownUntil: 0,
            consecutive429s: 0,
            consecutiveSuccesses: 0,
        });
    }

    if (members.length === 0) {
        // Pool creation failed for every candidate suffix. Surface the
        // underlying settings-hydration error so legacy callers see the
        // same `Missing ApiSetting: <name>` they saw before pools existed.
        // Falling back to a generic pool error would be a compat regression
        // for callers and tests that match on the specific error message.
        if (lastHydrateError) throw lastHydrateError;
        throw new Error(
            `No usable endpoints discovered for ${provider}:${endpointName ?? ""} (root=${root})`,
        );
    }

    const modelKey = `${provider}:${endpointName ?? ""}`;
    if (debugPool.enabled) {
        debugPool(
            `built pool ${modelKey}: ${members
                .map(
                    (m) =>
                        `{suffix=${m.suffix || "<bare>"}, priority=${m.priority}, mode=${m.mode}${m.region ? `, region=${m.region}` : ""}}`,
                )
                .join(", ")}`,
        );
    }
    return { modelKey, members };
}

export type PickResult =
    | { kind: "ready"; member: EndpointPoolMember }
    | { kind: "cooling"; member: EndpointPoolMember; waitMs: number };

/**
 * Pick a pool member to serve the next request. Strict priority between
 * tiers, random within tier: the lowest-priority tier that still has at
 * least one member with cooldownUntil <= now wins; within that tier, one
 * member is picked uniformly at random.
 *
 * If every tier is fully cooling down, returns the member whose cooldown
 * expires soonest along with the waitMs the caller should sleep.
 */
export function pickEndpoint(
    pool: EndpointPool,
    now: number = Date.now(),
    rng: () => number = Math.random,
): PickResult {
    if (pool.members.length === 0) {
        throw new Error(`pool ${pool.modelKey} has no members`);
    }

    const byPriority = new Map<number, EndpointPoolMember[]>();
    for (const m of pool.members) {
        const bucket = byPriority.get(m.priority);
        if (bucket) bucket.push(m);
        else byPriority.set(m.priority, [m]);
    }
    const tiers = [...byPriority.keys()].sort((a, b) => a - b);

    for (const tier of tiers) {
        const ready = byPriority
            .get(tier)!
            .filter((m) => m.cooldownUntil <= now);
        if (ready.length > 0) {
            const pick = ready[Math.floor(rng() * ready.length)];
            return { kind: "ready", member: pick };
        }
    }

    // Everyone cooling — return the one that recovers soonest.
    let soonest = pool.members[0];
    for (const m of pool.members) {
        if (m.cooldownUntil < soonest.cooldownUntil) soonest = m;
    }
    return {
        kind: "cooling",
        member: soonest,
        waitMs: Math.max(0, soonest.cooldownUntil - now),
    };
}

/**
 * Record a 429 on this member. Sets cooldownUntil to
 * max(retryAfterMs, base * 2^consecutive429s), capped at MAX_COOLDOWN_MS.
 */
export function markThrottled(
    member: EndpointPoolMember,
    retryAfterMs: number | undefined,
    now: number = Date.now(),
): void {
    const exponential = Math.min(
        BASE_COOLDOWN_MS * Math.pow(2, member.consecutive429s),
        MAX_COOLDOWN_MS,
    );
    const delay = Math.min(
        Math.max(retryAfterMs ?? 0, exponential),
        MAX_COOLDOWN_MS,
    );
    member.cooldownUntil = now + delay;
    member.consecutive429s += 1;
    member.consecutiveSuccesses = 0;
    debugPool(
        `markThrottled ${member.suffix || "<bare>"}: cooldown=${delay}ms (consecutive429s=${member.consecutive429s}, retryAfter=${retryAfterMs ?? "<none>"})`,
    );
}

/**
 * Record a transient non-429 failure (5xx, network error, timeout). Sets a
 * short floor cooldown so the next pick can prefer a healthier member but
 * doesn't compound with the 429 exponential multiplier.
 */
export function markTransientFailure(
    member: EndpointPoolMember,
    now: number = Date.now(),
): void {
    member.cooldownUntil = Math.max(
        member.cooldownUntil,
        now + TRANSIENT_FLOOR_COOLDOWN_MS,
    );
    member.consecutiveSuccesses = 0;
    debugPool(
        `markTransientFailure ${member.suffix || "<bare>"}: floor cooldown ${TRANSIENT_FLOOR_COOLDOWN_MS}ms`,
    );
}

/**
 * Record a successful call. After SUCCESS_STREAK_TO_RESET consecutive
 * successes, the 429 multiplier is reset so future cooldowns start small again.
 */
export function markSuccess(member: EndpointPoolMember): void {
    member.consecutiveSuccesses += 1;
    if (member.consecutiveSuccesses >= SUCCESS_STREAK_TO_RESET) {
        if (member.consecutive429s !== 0) {
            debugPool(
                `markSuccess ${member.suffix || "<bare>"}: reset 429 multiplier after ${member.consecutiveSuccesses} successes`,
            );
        }
        member.consecutive429s = 0;
    }
}
