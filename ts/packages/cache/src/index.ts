// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Types
export type {
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
    ExplanationOptions,
} from "./cache/cache.js";

// Functionalities
export {
    Action,
    Actions,
    RequestAction,
    normalizeParamValue,
    normalizeParamString,
    equalNormalizedParamValue,
    equalNormalizedParamObject,
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
