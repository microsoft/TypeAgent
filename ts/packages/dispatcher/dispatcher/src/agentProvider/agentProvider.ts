// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgent, AppAgentManifest } from "@typeagent/agent-sdk";
import { CommandHandlerTable } from "@typeagent/agent-sdk/helpers/command";

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
     * Register a provider's agent into this dispatcher's live state. Unlike the
     * old `installAppProvider`, the initial enabled state is NOT derived from
     * session config; `enable` is applied explicitly (the source sets it per its
     * policy — `true` for the issuing session, `false` for siblings; design §5).
     * Asserts the single-agent invariant
     * (`provider.getAppAgentNames().length === 1`). Resolves when APPLIED — may
     * be deferred until the session is idle.
     */
    addProvider(provider: AppAgentProvider, enable: boolean): Promise<void>;

    /**
     * Remove a previously-added provider from this dispatcher by provider
     * IDENTITY: unload its agent, drop schemas/grammars/embeddings, close any
     * live `SessionContext`, and drop the provider's records. Internally derives
     * the name(s) via `getAppAgentNames()` and calls the name-based
     * `removeAgent` per name. Resolves when APPLIED.
     */
    removeProvider(provider: AppAgentProvider): Promise<void>;
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

export interface AppAgentInstaller {
    // Install `ref`. With no sourceName, the registry walks the configured
    // resolution order (design §4.1) and the first matching source wins; an
    // explicit sourceName bypasses the order. Returns a freshly built provider
    // for the just-installed agent so the dispatcher can register it into the
    // live session without a restart (design §4.6).
    install(
        name: string,
        ref: string,
        sourceName?: string,
    ): Promise<InstallResult>;
    uninstall(name: string): Promise<void>;
    // Refresh an installed agent by re-resolving it against its recorded
    // source (feed bump / path refresh / catalog re-lookup), constrained by an
    // optional version `range` for feed sources. The old record is dropped only
    // after the new one materializes, so a failed update is a no-op (design §5,
    // §4.7, §12 Q13). Returns a freshly built provider for re-registration.
    // Optional: a host whose installer cannot read its record store omits it
    // and `@update` is unavailable. Lives on the installer (not a core handler)
    // because the dispatcher core never reads `agents.json` (layering).
    update?(name: string, range?: string): Promise<AppAgentProvider>;
    // The host-owned `@source` command table (list/order/where/remove/add),
    // merged into the system command tree as `@source` by the system agent.
    // The host owns the entire surface - the kind taxonomy, listing/ordering,
    // resolution preview, the add grammar + typed flags + validation, and any
    // auth UI; the dispatcher core never learns any of it. Absent -> `@source`
    // unavailable (like a host with no install sources).
    sourceCommands?(): CommandHandlerTable;
    // Host-rendered summaries of the installed agents, backing `@package list`.
    // The dispatcher core never reads the install-record store, so the
    // installer renders these; the core only formats them. Optional: a host
    // whose installer cannot enumerate its records omits it and `@package list`
    // is unavailable (layering, same rationale as `update`).
    listInstalled?(): InstalledAgentInfo[];
    // Names of the configured install sources, in resolution order. Used by the
    // core only to complete the `@package install --source` flag; the core
    // never interprets them. Optional: omitted when the installer has no source
    // registry (same layering rationale as `sourceCommands`).
    listSources?(): string[];
    // Enumerable agent refs across the configured sources (catalog/feed
    // advertise their agents; path sources don't). Used by the core only to
    // complete the `@package install` ref; the core never interprets them.
    // Optional: omitted when the installer has no enumerable sources.
    listAvailable?(): Promise<string[]>;
}

/**
 * A host-rendered one-line summary of a single installed agent, the only
 * install-record shape the dispatcher core sees (it never reads the record
 * store). The host maps its full record down to this for `@package list`.
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
