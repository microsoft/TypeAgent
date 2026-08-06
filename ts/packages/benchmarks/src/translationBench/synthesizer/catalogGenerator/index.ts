// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Catalog generator component (sibling concern to the data synthesizer).
 *
 * Pipeline (schema-only; no agent runtime / msal):
 *   defaultAgentProvider config + manifests/schemas
 *     → genCatalog (own process, streamed write)
 *     → catalog.generated.json
 *     → genActionParametersGrader (own process; --model when regex misses)
 *     → action-parameters-grader.generated.json
 *
 * Expected heap: genCatalog stays off ActionSchemaFileCache / agent runtime
 * (parse via @typeagent/action-schema + convertToActionConfig only). Grader
 * omits recommendedByAction on disk; derive via toRecommendedByActionVerifyMap.
 */

export * from "./paramTypes.js";
export * from "./schemaTypeConvert.js";
export * from "./actionParametersGrader.js";
