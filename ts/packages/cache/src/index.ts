// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Types
export type {
    JSONAction,
    FullAction,
    ParamValueType,
    ParamObjectType,
    HistoryContext,
    ActivityContext,
    PromptEntity,
} from "./explanation/requestAction.js";

export type { ConstructionStore } from "./cache/store.js";
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
export type { ExplanationOptions } from "./cache/explainWorkQueue.js";
export type { SchemaInfoProvider } from "./explanation/schemaInfoProvider.js";

// Functionalities
export {
    ExecutableAction,
    RequestAction,
    normalizeParamValue,
    normalizeParamString,
    equalNormalizedParamValue,
    equalNormalizedParamObject,
    toJsonActions,
    fromJsonActions,
    getFullActionName,
    createExecutableAction,
    toExecutableActions,
    toFullActions,
} from "./explanation/requestAction.js";
export { AgentCacheFactory, getDefaultExplainerName } from "./cache/factory.js";
export { MatchResult } from "./constructions/constructions.js";

// Testing
export { getNamespaceForCache } from "./explanation/schemaInfoProvider.js";
export { createActionProps } from "./constructions/constructionValue.js";

// Console printing.  REVIEW: move it to a separate export path?
export {
    printProcessExplanationResult,
    printProcessRequestActionResult,
    printImportConstructionResult,
} from "./utils/print.js";
