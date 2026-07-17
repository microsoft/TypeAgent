// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { AppAgent, AppAgentManifest } from "@typeagent/agent-sdk";

/**
 * A read-only view over a set of app agents: enumerate names, fetch manifests,
 * and load/unload agent instances. Implemented by the bundled providers, the
 * MCP provider, and the npm provider that backs installed agents.
 *
 * Implementor requirements:
 * - **Read-only.** Never mutate dispatcher state or reach into grammars,
 *   collision detection, or the embedding cache. This is purely a source of
 *   agents to load.
 * - **Stable names.** `getAppAgentNames()` must return the same names for the
 *   life of the provider. A provider handed to an app-agent-provider-set mutation
 *   must expose exactly one name (the host asserts this).
 * - **Balanced, refcount-safe load/unload.** When an instance is shared across
 *   sessions, N `loadAppAgent` calls require N `unloadAppAgent` calls before the
 *   underlying agent is actually torn down.
 * - **Honest `isLoaded`.** If implemented, it must reflect the true refcount
 *   (some holder loaded it without a matching unload); the installed-agent
 *   source's verify-0 barrier trusts it to confirm a version is fully released.
 *   Providers that do not refcount omit it (treated as always released).
 */
export interface AppAgentProvider {
    getAppAgentNames(): string[];
    getAppAgentManifest(appAgentName: string): Promise<AppAgentManifest>;
    loadAppAgent(appAgentName: string): Promise<AppAgent>;
    unloadAppAgent(appAgentName: string): Promise<void>;
    setTraceNamespaces?(namespaces: string): void;
    onSchemaReady?: (
        callback: (agentName: string, manifest: AppAgentManifest) => void,
    ) => void;
    getLoadingAgentNames?(): string[];
    /**
     * Return whether an agent has a loaded instance. A shared provider must
     * report its actual refcount state rather than one dispatcher's local state.
     */
    isLoaded?(appAgentName: string): boolean;
}

export type AddAppAgentProviderOptions = {
    /** Show the dispatcher-local notification for this change. */
    notify?: boolean;
    /**
     * Record the agent as already known to this session. Initial source
     * attachment uses false so load-time reconciliation can detect changes
     * that occurred while the session was offline.
     */
    recordAsKnown?: boolean;
};

export type RemoveAppAgentProviderOptions = {
    /** Show the dispatcher-local notification for this change. */
    notify?: boolean;
    /**
     * Clear the persisted enable preference. Uninstall uses true; update uses
     * false so the replacement keeps the user's preference.
     */
    dropConfig?: boolean;
};

/**
 * Temporary write access to one dispatcher's live app-agent set.
 *
 * The controller creates this capability for one `runExclusive` callback. The
 * capability stops accepting actions when that callback returns. Both methods
 * are leaf operations: they do not acquire the dispatcher command lock.
 */
export interface AppAgentProviderSetMutation {
    addProvider(
        provider: AppAgentProvider,
        options?: AddAppAgentProviderOptions,
    ): Promise<void>;
    removeProvider(
        provider: AppAgentProvider,
        options?: RemoveAppAgentProviderOptions,
    ): Promise<void>;
}

export type AppAgentProviderSetRunResult<T> =
    | { status: "completed"; value: T }
    | { status: "closed" };

/**
 * Host-facing control surface for one dispatcher's live app-agent set.
 *
 * The controller owns the dispatcher command lock. The host can mutate the set
 * only through the callback-scoped capability passed to `runExclusive`.
 */
export interface AppAgentProviderSetController {
    runExclusive<T>(
        callback: (mutation: AppAgentProviderSetMutation) => Promise<T> | T,
    ): Promise<AppAgentProviderSetRunResult<T>>;
}

/**
 * The dispatcher-facing surface of the dynamic (installed) agent set.
 * Injected as `appAgentSources` alongside the static `appAgentProviders`.
 * The concrete source object also carries the write/command surface
 * (`install`/`uninstall`/`update`/`packageCommands`), but the dispatcher is
 * handed only the narrow `connect` view, so it can never drive an install.
 *
 * Implementor requirements (a custom source, e.g. an embedder not using
 * `default-agent-provider`):
 * - **One `connect` per dispatcher.** Return the SHARED singleton provider
 *   instances (the same instances on every call) and record `controller` so later
 *   install/uninstall/update can be fanned out to that session.
 * - **Mutate only through the controller.** Reach live sessions only via
 *   {@link AppAgentProviderSetController.runExclusive}; never touch dispatcher internals.
 * - **Respect disposal.** Stop fanning out to a controller once its
 *   {@link AppAgentConnection.dispose} has been called; a fan-out that raced
 *   disposal must no-op.
 * - **Honor the swap barrier.** For replacement, remove the old provider,
 *   quiesce, await the shared decision, and add the decided provider inside one
 *   `runExclusive` callback.
 */
export interface AppAgentSource {
    /**
     * Called once per dispatcher at context init. Returns the provider(s) this
     * source contributes to THIS session plus a teardown handle. The source
     * records `controller` for fan-out.
     */
    connect(controller: AppAgentProviderSetController): AppAgentConnection;
}

/**
 * The result of {@link AppAgentSource.connect}: a promise of the provider(s) to
 * register into the connecting dispatcher plus a teardown handle.
 *
 * Implementor requirements:
 * - `providers` must resolve with the source's SHARED singletons, not
 *   per-session copies.
 * - `providers` must always resolve — immediately with the active set when
 *   nothing is in flight, or, when a teardown/swap is in flight, once every such
 *   barrier has settled and the source can snapshot a quiet active set — and
 *   must not outlive those barriers.
 * - `dispose()` must be idempotent and must only deregister THIS controller from
 *   fan-out; it must never tear down the shared providers other sessions hold.
 */
export interface AppAgentConnection {
    /**
     * Resolves with the provider instance(s) to register into the connecting
     * dispatcher via the normal addProvider path. These are SHARED singletons
     * owned by the source: every `connect()` returns the same instance(s), so a
     * loaded `AppAgent` is shared (refcounted) across all connected sessions
     * rather than cloned per session.
     *
     * Resolves immediately with the active set when nothing is in flight. When
     * this session connects while one or more teardown/swap barriers are in
     * flight (a name mid-`removing`), the source parks until every such barrier
     * has settled, then snapshots the now-quiet active set — which already
     * reflects each decided outcome (`v2` on a committed update, absent on an
     * uninstall, `v1` on a rollback), so there is no separate decided-version
     * fold. The dispatcher awaits this UNDER its held command lock during
     * connect, then registers the resolved provider(s) — so the session neither
     * loads a doomed version (verify-0 pollution) nor processes a command while
     * an agent is mid-swap. Because the dispatcher holds the command lock across
     * the await, any fan-out add/remove the source drives at this host is queued
     * behind it (FIFO) and applied only after the initial set lands. The
     * barriers decide independently of this session (bounded by their quiesce
     * timeout), so this never hangs.
     */
    readonly providers: Promise<AppAgentProvider[]>;
    /**
     * Deregisters THIS host from the source's fan-out registry. It does NOT tear
     * down the shared providers (other sessions still use them); the dispatcher
     * unregisters them from its own `AppAgentManager` as part of context
     * teardown.
     */
    dispose(): void;
}

export interface ConstructionProvider {
    getBuiltinConstructionConfig(
        explainerName: string,
    ): { data: string[]; file: string } | undefined;

    // extended: default is true to get all translation files
    getImportTranslationFiles(extended?: boolean): Promise<string[]>;
}
