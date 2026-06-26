// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Production wiring for the replay wildcard validator (fidelity rung L4a).
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
 */

import {
    createWildcardMatchValidator,
    DEFAULT_WILDCARD_VALIDATION_ALLOWLIST,
    type ReplayAppAgentLoader,
    type ReplayValidatableAgent,
    type WildcardMatchValidator,
} from "@typeagent/core/runtime";

/** Minimal structural view of an `AppAgentProvider` (avoids a type-only dep). */
interface AppAgentProviderLike {
    getAppAgentNames(): string[];
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
                const mod = (await import(
                    "default-agent-provider"
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
 * Build the runtime's `resolveWildcardValidator` option: returns a validator
 * only for allowlisted agents (so a non-allowlisted agent stays grammar-only
 * and the run doesn't claim a validation it can't perform), backed by the
 * lazy default loader. The dynamic import is deferred until a wildcard match
 * actually triggers `loadAppAgent`, so a run that never hits a wildcard never
 * pays for the provider.
 */
export function createDefaultWildcardValidatorResolver(): (
    agentName: string,
) => WildcardMatchValidator | undefined {
    const loader = createDefaultLoader();
    return (agentName) => {
        if (!DEFAULT_WILDCARD_VALIDATION_ALLOWLIST.includes(agentName)) {
            return undefined;
        }
        return createWildcardMatchValidator(agentName, { loader });
    };
}
