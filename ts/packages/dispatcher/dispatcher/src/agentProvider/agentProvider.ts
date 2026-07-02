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
