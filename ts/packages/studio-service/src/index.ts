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
 *
 * This barrel exposes only the package's external surface (what the `studio`
 * agent consumes). The process entrypoint ({@link ./main}) and the package's own
 * tests import the remaining modules (`studioService`, `studioServiceServer`,
 * `fileWorkspaceState`, …) directly.
 */

export {
    getStudioRuntime,
    resolveStudioRepoRootCandidates,
} from "./runtime.js";
export { StudioRegistryServer } from "./studioRegistry.js";
export { StudioServiceProxyClient } from "./studioServiceProxyClient.js";
