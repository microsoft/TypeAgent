// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The context-agnostic Studio runtime: the orchestration layer that wires the
 * `@typeagent/core` primitives (sandbox, corpus, events, feedback, health,
 * collisions, replay, onboarding) into a single {@link StudioRuntime}. It has
 * no VS Code dependency, so it is consumed identically by the VS Code extension
 * (human presenter) and the `studio` agent (AI / conversational presenter) via
 * a host-supplied {@link StudioRuntimeContext}.
 */
export * from "./studioRuntimeCore.js";
export * from "./repoRootResolver.js";
export { getDefaultPhaseInputs } from "./onboardingPhaseInputs.js";
