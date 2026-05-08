// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Public re-exports for runtime agents that consume uiCapture artifacts
// (discoveredActions.json + the helper binary). Generated agents import
// from this entry point: `import { ... } from "onboarding-agent/uiCapture"`.

export {
    HelperClient,
    HelperBinaryMissingError,
    buildHelperBinary,
} from "./helperClient.js";
export type {
    CapturedEvent,
    ControlSnapshot,
    EventHandler,
    EventType,
    HelperClientOptions,
    HelperRpcError,
} from "./helperClient.js";

export { executePlayback } from "./playbackExecutor.js";
export type {
    PlaybackExecutorOptions,
    PlaybackParams,
    PlaybackResult,
    PlaybackStepResult,
} from "./playbackExecutor.js";

export type {
    ActionVerb,
    DynamicControlRule,
    FingerprintResult,
    Pattern,
    Rect,
    Screenshot,
    SnapshotPolicy,
    SnapshotSource,
    ToggleState,
    TreeNode,
    WindowInfo,
} from "./types.js";

export type {
    ParamSpec,
    PlaybackStep,
    SynthesizedAction,
} from "./synthesisLlmSchema.js";

export {
    inferSnapshotPolicy,
    loadSnapshotPolicy,
    saveSnapshotPolicy,
} from "./snapshotPolicy.js";
