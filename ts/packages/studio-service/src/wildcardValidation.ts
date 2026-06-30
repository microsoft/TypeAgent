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
 * Whether wildcard validation can actually run for an agent: the agent loads and
 * exposes a `validateWildcardMatch`. Drives the Impact Report's validation
 * toggle — when false (no validator, or the provider is unavailable in the
 * packaged build) there is nothing to run, so the toggle is disabled. The agent
 * is loaded only to inspect for the method, then unloaded; any failure reports
 * not-validatable so the toggle stays off.
 */
export async function canValidateWildcards(
    agentName: string,
): Promise<boolean> {
    const providers = await loadProviders();
    if (providers === undefined) {
        return false;
    }
    const provider = findProvider(providers, agentName);
    if (provider === undefined) {
        return false;
    }
    let loaded = false;
    try {
        const agent = await provider.loadAppAgent(agentName);
        loaded = true;
        return typeof agent.validateWildcardMatch === "function";
    } catch {
        return false;
    } finally {
        if (loaded) {
            try {
                await provider.unloadAppAgent(agentName);
            } catch {
                // Best-effort cleanup; the run-time validator reloads as needed.
            }
        }
    }
}

/**
 * Build the runtime's `resolveWildcardValidator` option: returns a validator for
 * any agent, backed by the lazy default loader. The validator fail-opens
 * (load-failed / no-validator / errored diagnostics) so a run never fabricates a
 * lost match; whether validation is attempted at all is the operator's per-run
 * toggle, which the UI disables for agents that have no validator to run. The
 * dynamic import is deferred until a wildcard match actually triggers a lookup,
 * so a run that never hits a wildcard never pays for the provider.
 */
export function createDefaultWildcardValidatorResolver(): (
    agentName: string,
) => Promise<WildcardMatchValidator | undefined> {
    const loader = createDefaultLoader();
    return async (agentName) =>
        createWildcardMatchValidator(agentName, { loader });
}
