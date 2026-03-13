// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export { handleWebFlowAction, getWebFlowStore } from "./actionHandler.mjs";
export { WebFlowStore } from "./store/webFlowStore.mjs";
export { validateWebFlowScript } from "./scriptValidator.mjs";
export { executeWebFlowScript } from "./scriptExecutor.mjs";
export {
    generateAgrRule,
    generateAgrText,
    generateIncrementalAgrRule,
} from "./grammarGenerator.mjs";
export {
    createFrozenBrowserApi,
    WebFlowBrowserAPIImpl,
} from "./webFlowBrowserApi.mjs";
export type { WebFlowBrowserAPI } from "./webFlowBrowserApi.mjs";
export type {
    WebFlowDefinition,
    WebFlowParameter,
    WebFlowScope,
    WebFlowSource,
    WebFlowResult,
    WebFlowIndex,
    WebFlowIndexEntry,
    ElementQuery,
    ElementHandle,
    ValidationResult,
    ValidationError,
} from "./types.js";
export type { WebFlowActions } from "./schema/webFlowActions.mjs";
export { generateWebFlowFromTrace } from "./scriptGenerator.mjs";
export { normalizeRecording } from "./recordingNormalizer.mjs";
export type { RecordedAction, RecordingData } from "./recordingNormalizer.mjs";
export { BrowserReasoningAgent } from "./reasoning/browserReasoningAgent.mjs";
export type {
    BrowserReasoningConfig,
    BrowserReasoningTrace,
    BrowserTraceStep,
} from "./reasoning/browserReasoningTypes.mjs";
export { MacroToWebFlowConverter } from "./macroToWebFlowConverter.mjs";
export type { ConvertibleMacro } from "./macroToWebFlowConverter.mjs";
