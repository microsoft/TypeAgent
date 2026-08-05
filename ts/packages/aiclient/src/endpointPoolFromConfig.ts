// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Typed-config endpoint pool discovery.
 *
 * Counterpart to `endpointPool.ts:discoverEndpointPool`, which scans
 * env-var keys with `tailLooksLikeRegionSuffix` heuristics. This
 * version walks a typed `Config.azureOpenAI.deployments` map directly
 * — no string parsing, no prefix-collision guards, no `KNOWN_REGIONS`
 * duplication. The typed `Deployment.pool` is already sorted by
 * priority (PTU before PAYG), so we just iterate it.
 *
 * The `EndpointPool` shape returned here is identical to the legacy
 * one, so all the existing pool-runtime functions (`pickEndpoint`,
 * `markThrottled`, `markSuccess`, etc.) work unchanged.
 */

import registerDebug from "debug";
import { priorityQueue } from "async";
import type { Config, DeploymentEndpoint, Region } from "@typeagent/config";
import { regionToEnvSuffix } from "@typeagent/config";
import {
    azureApiSettingsFromConfig,
    openAIApiSettingsFromConfig,
} from "./apiSettingsFromConfig.js";
import type {
    EndpointMode,
    EndpointPool,
    EndpointPoolMember,
} from "./endpointPool.js";
import { ModelProviders, ModelType } from "./apiTypes.js";
import type { ApiSettings } from "./openai.js";
import type { FetchThrottler } from "./restClient.js";

const debugPool = registerDebug("typeagent:pool");

type PoolOverrideEntry = {
    suffix?: string;
    priority?: number;
    mode?: EndpointMode;
    tpm?: number;
};

function makeThrottler(maxConcurrency: number): FetchThrottler {
    const q = priorityQueue<() => Promise<any>>(
        async (task) => task(),
        maxConcurrency,
    );
    return (fn: () => Promise<any>) => q.push<any>(fn);
}

/**
 * Reconstruct the legacy env-var suffix for a deployment endpoint.
 * Used as a stable identity key so `AZURE_OPENAI_POOL_<MODEL>` JSON
 * overrides (which are keyed by suffix) keep working.
 *
 * Format: `<DEPLOYMENT_UPPER>_<REGION_UPPER>[_PTU]`. The deployment
 * portion already comes uppercased from the typed map keys (lowercase
 * snake-case in YAML, but the shim and env-var convention use upper).
 */
function suffixFor(
    deploymentName: string,
    endpoint: DeploymentEndpoint,
): string {
    const dep = deploymentName.toUpperCase();
    const reg = regionToEnvSuffix(endpoint.region);
    return endpoint.mode === "PTU" ? `${dep}_${reg}_PTU` : `${dep}_${reg}`;
}

function readPoolOverride(
    config: Config,
    deploymentName: string | undefined,
): Map<string, PoolOverrideEntry> | undefined {
    if (!deploymentName) return undefined;
    const overrideKey = `AZURE_OPENAI_POOL_${deploymentName.toUpperCase()}`;
    const raw = config.extra.get(overrideKey);
    if (!raw) return undefined;
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            debugPool(
                `ignoring ${overrideKey}: expected JSON array, got ${typeof parsed}`,
            );
            return undefined;
        }
        const m = new Map<string, PoolOverrideEntry>();
        for (const e of parsed) {
            if (e && typeof e === "object" && typeof e.suffix === "string") {
                m.set(e.suffix, e as PoolOverrideEntry);
            }
        }
        return m;
    } catch (e: any) {
        debugPool(`ignoring ${overrideKey}: invalid JSON (${e?.message})`);
        return undefined;
    }
}

function attachThrottler(settings: ApiSettings): void {
    if (
        settings.maxConcurrency !== undefined &&
        settings.throttler === undefined
    ) {
        settings.throttler = makeThrottler(settings.maxConcurrency);
    }
}

function memberFromEndpoint(
    deploymentName: string,
    region: Region,
    endpoint: DeploymentEndpoint,
    settings: ApiSettings,
    overrides?: Map<string, PoolOverrideEntry>,
): EndpointPoolMember {
    const suffix = suffixFor(deploymentName, endpoint);
    const override = overrides?.get(suffix);
    return {
        suffix,
        region,
        priority: override?.priority ?? endpoint.priority,
        mode: override?.mode ?? endpoint.mode,
        ...(override?.tpm !== undefined
            ? { declaredTpm: override.tpm }
            : endpoint.tpm !== undefined
              ? { declaredTpm: endpoint.tpm }
              : {}),
        settings,
        cooldownUntil: 0,
        consecutive429s: 0,
        consecutiveSuccesses: 0,
    };
}

/**
 * Build an endpoint pool from a typed `Config`.
 *
 * - For Azure: enumerate the named deployment's region map (or the
 *   service-default endpoint when no name is given for embedding/
 *   image/video), wrap each member in an ApiSettings via
 *   `azureApiSettingsFromConfig`, attach a per-member throttler.
 * - For OpenAI: single-member pool from `config.openAI`.
 * - Ollama: not supported (matches legacy).
 *
 * `AZURE_OPENAI_POOL_<MODEL>` JSON overrides in `config.extra` still
 * tweak per-member priority/mode/tpm by suffix, exactly like the
 * env-based path.
 */
export function discoverEndpointPoolFromConfig(
    config: Config,
    provider: ModelProviders,
    modelType: ModelType,
    deploymentName?: string,
): EndpointPool {
    if (provider === "ollama") {
        throw new Error(
            "discoverEndpointPoolFromConfig is not applicable to ollama provider",
        );
    }

    const modelKey = `${provider}:${deploymentName ?? ""}`;

    if (provider === "openai") {
        const settings = openAIApiSettingsFromConfig(config, modelType);
        attachThrottler(settings);
        return {
            modelKey,
            members: [
                {
                    suffix: deploymentName ?? "",
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

    // Azure path.
    const overrides = readPoolOverride(config, deploymentName);

    // Named-deployment case: walk the typed pool array directly.
    if (deploymentName !== undefined) {
        const dep = config.azureOpenAI.deployments.get(deploymentName);
        if (dep && dep.endpoints.length > 0) {
            const members: EndpointPoolMember[] = [];
            for (const endpoint of dep.endpoints) {
                let settings: ApiSettings;
                try {
                    settings = azureApiSettingsFromConfig(
                        config,
                        modelType,
                        deploymentName,
                        endpoint.region,
                    );
                } catch (e: any) {
                    debugPool(
                        `skipping pool member "${suffixFor(deploymentName, endpoint)}": ${e?.message}`,
                    );
                    continue;
                }
                attachThrottler(settings);
                members.push(
                    memberFromEndpoint(
                        deploymentName,
                        endpoint.region,
                        endpoint,
                        settings,
                        overrides,
                    ),
                );
            }
            if (members.length > 0) {
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
        }
        // Fall through: deployment not in typed map. Try the bare/service
        // default fallback below — `azureApiSettingsFromConfig` will throw
        // a descriptive "No Azure OpenAI endpoint configured" if there is
        // truly nothing to fall back to.
    }

    // Bare / service-default case (no deploymentName, or named lookup
    // missed and we want the same "missing setting" error legacy callers
    // would have seen).
    const settings = azureApiSettingsFromConfig(
        config,
        modelType,
        deploymentName,
    );
    attachThrottler(settings);
    return {
        modelKey,
        members: [
            {
                suffix: deploymentName ?? "",
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
