// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Re-export CacheClient for use in other packages
export { CacheClient, CacheCheckResult } from "coder-wrapper";
export { DebugLogger } from "coder-wrapper";

// Export schema reading utilities
export {
    loadSchemaInfo,
    getWildcardType,
    shouldUseTypedWildcard,
    type SchemaInfo,
    type ActionInfo,
    type ParameterValidationInfo,
} from "./schemaReader.js";

// Export grammar generation utilities
export {
    SchemaToGrammarGenerator,
    type SchemaGrammarConfig,
    type SchemaGrammarResult,
} from "./schemaToGrammarGenerator.js";
