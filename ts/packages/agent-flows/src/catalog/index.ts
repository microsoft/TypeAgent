// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type {
    AutomationKind,
    AutomationStatus,
    AutomationVerb,
    AutomationSummary,
    AutomationParameter,
    AutomationFact,
    AutomationStep,
    AutomationDetail,
    AutomationProviderStatus,
    AutomationCatalog,
    AutomationValidationIssue,
    AutomationValidationReport,
} from "./types.js";
export { automationId, parseAutomationId } from "./types.js";
export type {
    FlowIndexEntryLike,
    FlowIndexParameterLike,
    PowerShellDefinitionLike,
    TaskFlowDefinitionLike,
    WebFlowLike,
    MacroLike,
    MacroValueExpressionLike,
} from "./summarize.js";
export {
    extractRulePatterns,
    summarizePowerShellFlow,
    detailForPowerShellFlow,
    summarizeTaskFlow,
    detailForTaskFlow,
    summarizeWebFlow,
    detailForWebFlow,
    summarizeMacro,
    detailForMacro,
    describeExpression,
} from "./summarize.js";
export type {
    MacroCatalogSource,
    AutomationCatalogSources,
    AutomationCatalogService,
} from "./service.js";
export { createAutomationCatalogService } from "./service.js";
