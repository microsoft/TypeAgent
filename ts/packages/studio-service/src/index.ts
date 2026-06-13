// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * `studio-service` — the standalone, per-workspace host of the Studio runtime
 * (`@typeagent/core/runtime`) and its typed `agent-rpc` service channel.
 *
 * Per the runtime-placement decision (see `docs/plans/vscode-devx/DESIGN.md`
 * §3.5), the Studio runtime's affinity is to the developer's workspace, not to an
 * agent-server session, so it runs here — launched by the `typeagent-studio`
 * extension or the `typeagent-studio serve` CLI ({@link ./main}) — and the
 * `studio` agent and the extension are clients of it.
 */

export {
    StudioServiceServer,
    createWebSocketRpcChannel,
    type StudioRuntimeResolver,
} from "./studioServiceServer.js";
export {
    getStudioRuntime,
    resolveStudioRepoRootCandidates,
} from "./runtime.js";
export {
    createStudioInvokeHandlers,
    type StudioServiceConnection,
} from "./studioRpcHandlers.js";
export {
    FileWorkspaceState,
    studioWorkspaceStateFile,
} from "./fileWorkspaceState.js";
export {
    startStudioService,
    type StudioServiceHandle,
} from "./studioService.js";
export {
    StudioRegistryServer,
    announceStudioService,
    lookupStudioService,
    discoverRegistryEndpoint,
    type StudioServiceAnnouncement,
    type RegistryClientOptions,
} from "./studioRegistry.js";
