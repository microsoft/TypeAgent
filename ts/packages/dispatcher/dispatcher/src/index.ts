// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export { createDispatcher } from "./dispatcher.js";
export { IndexManager } from "./context/indexManager.js";
export type { DispatcherOptions } from "./context/commandHandlerContext.js";
export {
    PortRegistrar,
    SYSTEM_SESSION_CONTEXT_ID,
} from "./context/portRegistrar.js";
export type {
    IPortRegistrar,
    Allocation as PortAllocation,
    RegistrationId as PortRegistrationId,
} from "./context/portRegistrar.js";
export type {
    AppAgentProvider,
    AppAgentInstaller,
    ConstructionProvider,
} from "./agentProvider/agentProvider.js";
export type {
    InstallSourceKind,
    PathSourceConfig,
    FeedSourceConfig,
    CatalogSourceConfig,
    InstallSourceConfig,
    ResolvedCandidate,
    InstalledAgentRecord,
    InstallSource,
    InstallSourceRegistry,
} from "./agentProvider/installSource.js";
export type {
    IndexingServiceRegistry,
    IndexingServiceInfo,
} from "./context/indexingServiceRegistry.js";
export { DefaultIndexingServiceRegistry } from "./context/indexingServiceRegistry.js";
export * from "@typeagent/dispatcher-types";
export { StorageProvider } from "./storageProvider/storageProvider.js";
export {
    readDevTunnelConfig,
    saveDevTunnelConfig,
} from "./helpers/userData.js";
export type { DevTunnelConfig } from "./helpers/userData.js";
