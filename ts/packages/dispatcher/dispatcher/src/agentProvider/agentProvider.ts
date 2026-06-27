// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgent, AppAgentManifest } from "@typeagent/agent-sdk";
import { InstallSourceRegistry } from "./installSource.js";

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
    ): Promise<AppAgentProvider>;
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
    // Host-owned registry powering @source (design §4.5); absent -> @source
    // unavailable.
    sources?(): InstallSourceRegistry;
    // Names of installed agents whose record was acquired from `sourceName`.
    // Powers `@source remove`'s "still referenced" warning. Optional for the
    // same layering reason as `update` (the core handler cannot read records).
    recordsUsingSource?(sourceName: string): string[];
}

export interface ConstructionProvider {
    getBuiltinConstructionConfig(
        explainerName: string,
    ): { data: string[]; file: string } | undefined;

    // extended: default is true to get all translation files
    getImportTranslationFiles(extended?: boolean): Promise<string[]>;
}
