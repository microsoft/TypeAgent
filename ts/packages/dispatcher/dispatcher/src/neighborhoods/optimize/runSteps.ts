// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Zero-dependency step-list constant. Lives in its own file so both the
// `runPipeline` orchestrator and the `collisionOptimizeHandlers` command
// surface can import it without triggering a circular-init cycle —
// during dispatcher startup the handler table eagerly references
// `RUN_STEPS` in its parameter descriptions, before any of the heavier
// pipeline modules have finished loading.

export const RUN_STEPS = [
    "neighborhoods",
    "explore",
    "validate",
    "patterns",
    "distill",
] as const;
export type RunStep = (typeof RUN_STEPS)[number];
