// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Production wiring for the replay wildcard validator.
 *
 * The core `@typeagent/core` runtime exposes the validation algorithm but is
 * dependency-light and does NOT know how to load a real agent module. The real
 * loader lives in `default-agent-provider` (the dispatcher's agent providers),
 * which drags in the whole dispatcher + every agent — far too heavy to bundle
 * into the standalone, esbuild-bundled Studio service.
 *
 * So we load it **lazily, by dynamic import, marked external in the service
 * bundle**: it resolves from `node_modules` on the in-repo `typeagent-studio
 * serve` dev path, and cleanly throws → no-ops in the packaged `.vsix` (which
 * ships without `node_modules`). Wildcard validation is opt-in and fail-open, so
 * when the provider is unavailable replay simply stays grammar-only.
 *
 * NOTE: `default-agent-provider` is intentionally NOT a package.json dependency
 * of this service. `default-agent-provider` aggregates every agent including
 * `studio-agent`, which depends on this service — declaring the dep here closes
 * a build cycle (studio-service → default-agent-provider → studio-agent →
 * studio-service). Because the import is external + dynamic, the dependency is
 * owned by the bundling host (`typeagent-studio`, a leaf nothing depends on),
 * whose `node_modules` the external import resolves against at runtime.
 */

import {
    createWildcardMatchValidator,
    type ReplayAppAgentLoader,
    type ReplayValidatableAgent,
    type WildcardMatchValidator,
} from "@typeagent/core/runtime";

/** The single manifest field that gates replay wildcard validation. */
interface ReplaySafeManifestLike {
    replaySafeWildcardValidator?: boolean;
}

/** Minimal structural view of an `AppAgentProvider` (avoids a type-only dep). */
interface AppAgentProviderLike {
    getAppAgentNames(): string[];
    getAppAgentManifest(agentName: string): Promise<ReplaySafeManifestLike>;
    loadAppAgent(agentName: string): Promise<ReplayValidatableAgent>;
    unloadAppAgent(agentName: string): Promise<void>;
}

interface DefaultAgentProviderModule {
    getDefaultAppAgentProviders(
        instanceDir: string | undefined,
    ): AppAgentProviderLike[];
}

let providersPromise: Promise<AppAgentProviderLike[] | undefined> | undefined;

/**
 * Lazily import `default-agent-provider` and build the default providers once.
 * Returns `undefined` (cached) when the module can't be resolved — e.g. inside
 * the packaged extension where `node_modules` was stripped — so validation
 * silently degrades to grammar-only instead of erroring.
 */
async function loadProviders(): Promise<AppAgentProviderLike[] | undefined> {
    if (providersPromise === undefined) {
        providersPromise = (async () => {
            try {
                // Indirect the specifier through a variable so TypeScript does
                // not statically resolve the module: `default-agent-provider` is
                // deliberately not a build-time dependency of this service (it
                // would close a studio-service → default-agent-provider →
                // studio-agent → studio-service build cycle). It is resolved at
                // runtime from the bundling extension's `node_modules`, and the
                // result is cast to the local structural type below.
                const specifier = "default-agent-provider";
                const mod = (await import(
                    specifier
                )) as DefaultAgentProviderModule;
                return mod.getDefaultAppAgentProviders(undefined);
            } catch {
                return undefined;
            }
        })();
    }
    return providersPromise;
}

function findProvider(
    providers: AppAgentProviderLike[],
    agentName: string,
): AppAgentProviderLike | undefined {
    return providers.find((p) => {
        try {
            return p.getAppAgentNames().includes(agentName);
        } catch {
            return false;
        }
    });
}

/** A {@link ReplayAppAgentLoader} backed by the dispatcher's agent providers. */
function createDefaultLoader(): ReplayAppAgentLoader {
    return {
        async loadAppAgent(agentName) {
            const providers = await loadProviders();
            if (providers === undefined) {
                throw new Error(
                    "default-agent-provider unavailable (packaged build?)",
                );
            }
            const provider = findProvider(providers, agentName);
            if (provider === undefined) {
                throw new Error(`no provider owns agent "${agentName}"`);
            }
            return provider.loadAppAgent(agentName);
        },
        async unloadAppAgent(agentName) {
            const providers = await loadProviders();
            if (providers === undefined) {
                return;
            }
            const provider = findProvider(providers, agentName);
            await provider?.unloadAppAgent(agentName);
        },
    };
}

/**
 * Whether the agent's manifest opts its `validateWildcardMatch` into replay. Any
 * lookup failure (provider unavailable, agent unknown, manifest read error) is
 * treated as not safe, so replay stays grammar-only.
 */
async function isReplaySafe(agentName: string): Promise<boolean> {
    try {
        const providers = await loadProviders();
        if (providers === undefined) {
            return false;
        }
        const provider = findProvider(providers, agentName);
        if (provider === undefined) {
            return false;
        }
        const manifest = await provider.getAppAgentManifest(agentName);
        return manifest.replaySafeWildcardValidator === true;
    } catch {
        return false;
    }
}

/**
 * Build the runtime's `resolveWildcardValidator` option: returns a validator
 * only for agents whose manifest declares `replaySafeWildcardValidator` (so any
 * other agent stays grammar-only and the run doesn't claim a validation it can't
 * perform), backed by the lazy default loader. The dynamic import is deferred
 * until a wildcard match actually triggers a lookup, so a run that never hits a
 * wildcard never pays for the provider.
 */
export function createDefaultWildcardValidatorResolver(): (
    agentName: string,
) => Promise<WildcardMatchValidator | undefined> {
    const loader = createDefaultLoader();
    return async (agentName) => {
        if (!(await isReplaySafe(agentName))) {
            return undefined;
        }
        return createWildcardMatchValidator(agentName, { loader });
    };
}
