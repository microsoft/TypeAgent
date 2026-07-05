// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgent, AppAgentManifest } from "@typeagent/agent-sdk";

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
    // Optional: the current load refcount for an agent (design §5.6) — how many
    // holders have `loadAppAgent`-ed it without a matching `unloadAppAgent`. The
    // installed-agent source's coordinated teardown/swap reads this to VERIFY a
    // torn-down version's shared process is fully released (count 0) before it
    // starts the new version or frees the name, rather than inferring it from
    // teardown ACKs. Providers that do not refcount omit it (treated as 0).
    getRefCount?(appAgentName: string): number;
    // Optional companion to {@link getRefCount}: whether the agent currently has
    // a loaded (refcounted) instance. Diagnostics only — the verify-0 teardown
    // gate uses {@link getRefCount} (count 0) exclusively, not this. Omitted by
    // providers that do not refcount.
    isLoaded?(appAgentName: string): boolean;
}

/**
 * The dispatcher-side client callback an {@link AppAgentSource} uses to mutate a
 * single connected session's live agent set (design §3.1). Implemented by the
 * dispatcher (one per `CommandHandlerContext`); the source holds one per
 * connected session and calls it to fan install/uninstall/update out to that
 * session.
 *
 * It is the *only* surface the source uses to mutate live dispatcher state; the
 * source never reaches into grammars, collision detection, or the embedding
 * cache. Both operations are applied through an idle-gated FIFO applicator and
 * resolve when the op is **applied** (the ack the source's lifecycle tracker
 * waits on, design §7).
 */
export interface AppAgentHost {
    /**
     * Register a provider's agent into this dispatcher's live state. The initial
     * enabled state is derived from session config with the agent's manifest
     * default as the fallback (design §5, Model B): an installed agent honors its
     * manifest default just like a bundled agent, and a user's per-session
     * `@config agent` override still wins. Asserts the single-agent invariant
     * (`provider.getAppAgentNames().length === 1`). Resolves when APPLIED — may
     * be deferred until the session is idle.
     *
     * `notify` (design §5): when true, the dispatcher surfaces a system message
     * naming the agent and its resulting state. Because every op — including the
     * issuing session's — now applies asynchronously through the idle-gated
     * queue (the inline path was removed, §5.4), the issuing session is notified
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
     * `notify` (design §5): when true, the dispatcher surfaces a system message
     * that the agent was uninstalled/updated. As with {@link addProvider}, the
     * issuing session is notified like a sibling now that every op applies
     * through the idle-gated queue (§5.4).
     *
     * `dropConfig` (design §5, Model B): when true (default — an explicit
     * `@uninstall`), the agent's persisted enable preference (its
     * schema/action/command overrides) is cleared so a fresh reinstall starts
     * from the manifest default. An `@update` passes `false` so the remove leg
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
     * critical section (design §5.1, §5.7) — the primitive both `@update` and
     * `@uninstall` fan out through, replacing a separate remove-then-add. On this
     * dispatcher it runs, under a SINGLE command-lock acquisition (no request can
     * interleave, closing the update request-slip of §5):
     *
     *   1. remove `oldProvider` (unload its agent — decrement the SHARED
     *      refcount — and drop its routing artifacts), exactly like
     *      {@link removeProvider};
     *   2. call `onQuiesced()` to fill this host's slot in the source's barrier;
     *   3. `await whenReady` — park (still holding the lock) until the source has
     *      every host's quiesce ACK AND has VERIFIED the shared old refcount is 0
     *      (design §5.6), so the old version is confirmed terminated everywhere
     *      before anything new starts;
     *   4. if `newProviderThunk` is given, call it AFTER the barrier releases and
     *      add whatever it returns, exactly like {@link addProvider}. The source
     *      decides post-barrier what to add (design §5.3): the NEW version on a
     *      committed `@update`, the OLD version on a cancelled/timed-out update
     *      that ROLLS BACK (`v1` restored), or `undefined` (no add) on a
     *      committed `@uninstall` (`old → ∅`). A `newProviderThunk` of `undefined`
     *      at call time is an unconditional no-add (uninstall that can never roll
     *      back).
     *
     * No two versions of the name ever coexist, and no session observes the name
     * absent across the swap. **Leaf-op invariant (§5.7):** the teardown and
     * startup legs run under the held command lock and must be leaf ops — process
     * teardown/launch only, never dispatching a command or reacquiring the lock.
     *
     * `notify`/`dropConfig` are forwarded to the remove/add legs exactly as for
     * {@link removeProvider}/{@link addProvider} (an update passes
     * `dropConfig=false` to preserve the enable preference across the bump; an
     * uninstall passes `true`). On {@link dispose} mid-op the host is dropped
     * from the barrier and the op auto-acks (design §7.3).
     */
    replaceProvider(
        oldProvider: AppAgentProvider,
        newProviderThunk: (() => AppAgentProvider | undefined) | undefined,
        options: ReplaceProviderOptions,
    ): Promise<void>;
}

/**
 * The source-coordinated barrier hooks passed to {@link AppAgentHost.replaceProvider}
 * (design §5.6, §5.7).
 */
export interface ReplaceProviderOptions {
    /**
     * Called by the host once it has torn down `oldProvider` (its leg of the
     * teardown is done) — fills this host's slot in the source's barrier.
     */
    onQuiesced: () => void;
    /**
     * Resolved by the SOURCE once every host has quiesced AND verify-0 passes
     * (the shared old refcount is confirmed 0, design §5.6). Each host parks on
     * it — under its held command lock — before starting the new version / being
     * released, so the old version is confirmed gone everywhere first.
     */
    whenReady: Promise<void>;
    /** Forwarded to the remove/add legs (sibling fan-out message, design §5). */
    notify?: boolean;
    /**
     * Forwarded to the remove leg (design §5, Model B): `true` for an uninstall
     * (clear the enable preference), `false` for an update (preserve it).
     */
    dropConfig?: boolean;
}

/**
 * The dispatcher-facing surface of the dynamic (installed) agent set (design
 * §3.2). Injected as `appAgentSources` alongside the static `appAgentProviders`.
 * The concrete host object also carries the write/command surface
 * (`install`/`uninstall`/`update`/`packageCommands`), but the dispatcher is
 * handed only the narrow `connect` view, so it can never drive an install.
 */
export interface AppAgentSource {
    /**
     * Called once per dispatcher at context init. Returns the provider(s) this
     * source contributes to THIS session plus a teardown handle. The source
     * records `host` for fan-out (design §4).
     */
    connect(host: AppAgentHost): AppAgentConnection;
}

/**
 * The result of {@link AppAgentSource.connect}: the provider(s) to register into
 * the connecting dispatcher plus a teardown handle (design §3.2).
 */
export interface AppAgentConnection {
    /**
     * The provider instance(s) to register into the connecting dispatcher via
     * the normal addProvider path. These are SHARED singletons owned by the
     * source: every `connect()` returns the same instance(s), so a loaded
     * `AppAgent` is shared (refcounted) across all connected sessions rather
     * than cloned per session.
     */
    readonly providers: AppAgentProvider[];
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
    // The resolution handle that identifies the install (feed specifier /
    // package name / path), whichever the record carries. Omitted if none.
    handle?: string;
}

/**
 * The outcome of a successful install: the freshly built provider for the
 * just-installed agent (for live registration) plus the name of the source the
 * ref resolved to, so the core can report which source won.
 */
export interface InstallResult {
    provider: AppAgentProvider;
    source: string;
    // Non-fatal warnings surfaced while resolving the ref (e.g. a corrupt
    // catalog file skipped, or a malformed catalog entry dropped) that the core
    // should show to the user for this command. Absent/empty when clean.
    warnings?: string[];
}

export interface ConstructionProvider {
    getBuiltinConstructionConfig(
        explainerName: string,
    ): { data: string[]; file: string } | undefined;

    // extended: default is true to get all translation files
    getImportTranslationFiles(extended?: boolean): Promise<string[]>;
}
