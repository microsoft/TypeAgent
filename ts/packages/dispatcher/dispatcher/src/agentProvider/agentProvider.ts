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
     * `notify` (design §5): when true, this is a cross-session fan-out to a
     * SIBLING; the dispatcher surfaces a system message naming the agent and its
     * resulting state. The issuing session passes `false` and reports inline.
     */
    addProvider(provider: AppAgentProvider, notify?: boolean): Promise<void>;

    /**
     * Remove a previously-added provider from this dispatcher by provider
     * IDENTITY: unload its agent, drop schemas/grammars/embeddings, close any
     * live `SessionContext`, and drop the provider's records. Internally derives
     * the name(s) via `getAppAgentNames()` and calls the name-based
     * `removeAgent` per name. Resolves when APPLIED.
     *
     * `notify` (design §5): when true (sibling fan-out), the dispatcher surfaces
     * a system message that the agent was uninstalled.
     */
    removeProvider(provider: AppAgentProvider, notify?: boolean): Promise<void>;
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
