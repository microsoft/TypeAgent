// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgent, AppAgentManifest } from "@typeagent/agent-sdk";

/**
 * A read-only view over a set of app agents: enumerate names, fetch manifests,
 * and load/unload agent instances. Implemented by the bundled providers, the
 * MCP provider, and the npm provider that backs installed agents.
 *
 * Implementor requirements:
 * - **Read-only.** Never mutate dispatcher state or reach into grammars,
 *   collision detection, or the embedding cache — this is purely a source of
 *   agents to load.
 * - **Stable names.** `getAppAgentNames()` must return the same names for the
 *   life of the provider. A provider handed to {@link AppAgentHost.addProvider}
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
    // Optional: providers that start slowly can return a stub manifest from
    // getAppAgentManifest and call the registered callback with the real
    // manifest once the agent is ready.
    onSchemaReady?: (
        callback: (agentName: string, manifest: AppAgentManifest) => void,
    ) => void;
    // Optional: returns the names of agents currently loading asynchronously.
    // Only these agents should show ⏳ in the UI. If omitted, no agents are
    // treated as loading.
    getLoadingAgentNames?(): string[];
    // Optional: whether the agent currently has a loaded (refcounted) instance —
    // i.e. some holder has `loadAppAgent`-ed it without a matching
    // `unloadAppAgent`. The installed-agent source's coordinated
    // teardown/swap reads this to VERIFY a torn-down version's shared process is
    // fully released (not loaded anywhere) before it starts the new version or
    // frees the name, rather than inferring it from teardown ACKs. Providers that
    // do not refcount omit it (treated as released).
    isLoaded?(appAgentName: string): boolean;
}

/**
 * The dispatcher-side client callback an {@link AppAgentSource} uses to mutate a
 * single connected session's live agent set. Implemented by the
 * dispatcher (one per `CommandHandlerContext`); the source holds one per
 * connected session and calls it to fan install/uninstall/update out to that
 * session.
 *
 * It is the *only* surface the source uses to mutate live dispatcher state; the
 * source never reaches into grammars, collision detection, or the embedding
 * cache. Both operations are applied through an idle-gated FIFO applicator and
 * resolve when the op is **applied** (the ack the source's lifecycle tracker
 * waits on).
 *
 * Implementor (the dispatcher) must guarantee:
 * - **FIFO, idle-gated apply.** Ops are applied in call order and deferred until
 *   the session is idle; each returned promise resolves only once the op has
 *   been applied (the source's lifecycle tracker treats that resolution as the
 *   ack).
 * - **Single-agent registration.** `addProvider` asserts the provider exposes
 *   exactly one name.
 * - **Identity-based removal.** `removeProvider`/`replaceProvider` match the
 *   provider by identity, not by name.
 * - **Command-lock-held swap.** `replaceProvider` runs its remove → park → add
 *   as one command-lock-held section so no request interleaves the swap.
 * - **Disposal safety.** After the session's {@link AppAgentConnection.dispose},
 *   a late op must no-op, and a barrier the host is mid-parking on auto-acks.
 */
export interface AppAgentHost {
    /**
     * Register a provider's agent into this dispatcher's live state. The initial
     * enabled state is derived from session config with the agent's manifest
     * default as the fallback: an installed agent honors its
     * manifest default just like a bundled agent, and a user's per-session
     * `@config agent` override still wins. Asserts the single-agent invariant
     * (`provider.getAppAgentNames().length === 1`). Resolves when APPLIED — may
     * be deferred until the session is idle.
     *
     * `notify`: when true, the dispatcher shows a system message
     * naming the agent and its resulting state. Because every op — including the
     * issuing session's — now applies asynchronously through the idle-gated
     * queue (the inline path was removed), the issuing session is notified
     * like a sibling so the terminal outcome is reported when the op settles.
     */
    addProvider(provider: AppAgentProvider, notify?: boolean): Promise<void>;

    /**
     * Remove a previously-added provider from this dispatcher by provider
     * IDENTITY: unload its agent, drop schemas/grammars/embeddings, close any
     * live `SessionContext`, and drop the provider's records. Internally derives
     * the name(s) via `getAppAgentNames()` and calls the name-based
     * `removeAgent` per name. Resolves when APPLIED.
     *
     * `notify`: when true, the dispatcher shows a system message
     * that the agent was uninstalled/updated. As with {@link addProvider}, the
     * issuing session is notified like a sibling now that every op applies
     * through the idle-gated queue.
     *
     * `dropConfig`: when true (default — an explicit
     * `@package uninstall`), the agent's persisted enable preference (its
     * schema/action/command overrides) is cleared so a fresh reinstall starts
     * from the manifest default. An `@package update` passes `false` so the remove leg
     * of its remove-then-add swap preserves the user's per-session preference
     * across a version bump.
     */
    removeProvider(
        provider: AppAgentProvider,
        notify?: boolean,
        dropConfig?: boolean,
    ): Promise<void>;

    /**
     * Coordinated teardown/swap of an installed agent as ONE command-lock-held
     * critical section — the primitive both `@package update` and
     * `@package uninstall` fan out through, replacing a separate remove-then-add. On this
     * dispatcher it runs, under a SINGLE command-lock acquisition (no request can
     * interleave, closing the update request-slip):
     *
     *   1. remove `oldProvider` (unload its agent — decrement the SHARED
     *      refcount — and drop its routing artifacts), exactly like
     *      {@link removeProvider};
     *   2. call `resolveReplacement` so the source can fill this host's barrier
     *      slot, park on its coordinated release promise, and decide what to add;
     *   3. if `resolveReplacement` returns a provider, add it exactly like
     *      {@link addProvider}. The source decides post-barrier what to add: the NEW version on a
     *      committed `@package update`, the OLD version on a cancelled/timed-out update
     *      that ROLLS BACK (`v1` restored), or `undefined` (no add) on a
     *      committed `@package uninstall` (`old → ∅`). `undefined` means no add.
     *
     * No two versions of the name ever coexist, and no session observes the name
     * absent across the swap. **Leaf-op invariant:** the teardown and
     * startup legs run under the held command lock and must be leaf ops — process
     * teardown/launch only, never dispatching a command or reacquiring the lock.
     *
     * `notify`/`dropConfig` are forwarded to the remove/add legs exactly as for
     * {@link removeProvider}/{@link addProvider} (an update passes
     * `dropConfig=false` to preserve the enable preference across the bump; an
     * uninstall passes `true`). On {@link dispose} mid-op the host is dropped
     * from the barrier and the op auto-acks.
     */
    replaceProvider(
        oldProvider: AppAgentProvider,
        resolveReplacement: () => Promise<AppAgentProvider | undefined>,
        notify?: boolean,
        dropConfig?: boolean,
    ): Promise<void>;
}

/**
 * The dispatcher-facing surface of the dynamic (installed) agent set.
 * Injected as `appAgentSources` alongside the static `appAgentProviders`.
 * The concrete host object also carries the write/command surface
 * (`install`/`uninstall`/`update`/`packageCommands`), but the dispatcher is
 * handed only the narrow `connect` view, so it can never drive an install.
 *
 * Implementor requirements (a custom source, e.g. an embedder not using
 * `default-agent-provider`):
 * - **One `connect` per dispatcher.** Return the SHARED singleton provider
 *   instances (the same instances on every call) and record `host` so later
 *   install/uninstall/update can be fanned out to that session.
 * - **Mutate only through `host`.** Reach live sessions only via the given
 *   {@link AppAgentHost}; never touch dispatcher internals directly.
 * - **Respect disposal.** Stop fanning out to a host once its
 *   {@link AppAgentConnection.dispose} has been called; a fan-out that raced
 *   disposal must no-op.
 * - **Honor the swap barrier.** When driving {@link AppAgentHost.replaceProvider},
 *   its async new-provider thunk should not resolve until every host has
 *   quiesced and the old version's shared refcount is verified 0.
 */
export interface AppAgentSource {
    /**
     * Called once per dispatcher at context init. Returns the provider(s) this
     * source contributes to THIS session plus a teardown handle. The source
     * records `host` for fan-out.
     */
    connect(host: AppAgentHost): AppAgentConnection;
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
 * - `dispose()` must be idempotent and must only deregister THIS host from
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

/**
 * A host-rendered one-line summary of a single installed agent. The host maps
 * its full `agents.json` record down to this for `@package list`. (The dispatcher
 * core no longer reads the record store; this type is shared with the host's
 * `AppAgentSource` implementation in `default-agent-provider`.)
 */
export interface InstalledAgentInfo {
    name: string; // dispatcher agent name
    source: string; // provenance (name of the source it was installed from)
    // The reference that identifies the install (feed specifier / package name /
    // path), whichever the record carries. Omitted if none.
    ref?: string;
}

export interface ConstructionProvider {
    getBuiltinConstructionConfig(
        explainerName: string,
    ): { data: string[]; file: string } | undefined;

    // extended: default is true to get all translation files
    getImportTranslationFiles(extended?: boolean): Promise<string[]>;
}
