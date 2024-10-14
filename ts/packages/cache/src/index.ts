// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Types
export type {
    IAction,
    JSONAction,
    FullAction,
    ParamValueType,
    ParamObjectType,
    HistoryContext,
} from "./explanation/requestAction.js";

export type { ConstructionStore } from "./cache/store.js";
export type { SchemaConfig } from "./explanation/schemaConfig.js";
export type {
    GenericExplanationResult,
    CorrectionRecord,
} from "./explanation/genericExplainer.js";

export type {
    ExplanationDataEntry,
    ExplanationData,
} from "./explanation/explanationData.js";
export type { ImportConstructionResult } from "./constructions/importConstructions.js";

export type {
    AgentCache,
    CacheConfig,
    ProcessRequestActionResult,
} from "./cache/cache.js";

// Functionalities
export {
    Action,
    Actions,
    RequestAction,
    normalizeParamValue,
    equalNormalizedParamValue,
} from "./explanation/requestAction.js";
export { AgentCacheFactory, getDefaultExplainerName } from "./cache/factory.js";
export { MatchResult } from "./constructions/constructions.js";

// Testing
export { getNamespaceForCache } from "./explanation/schemaConfig.js";
export { createActionProps } from "./constructions/constructionValue.js";

// Console printing.  REVIEW: move it to a separate export path?
export {
    printProcessExplanationResult,
    printProcessRequestActionResult,
    printImportConstructionResult,
} from "./utils/print.js";

// REVIEW: For experimentation with specialized explainers.  Need to examine whether we want to support this long term.
export {
    buildExplanationInstructions,
    createExplainer,
    Explainer,
} from "./explanation/explainer.js";
