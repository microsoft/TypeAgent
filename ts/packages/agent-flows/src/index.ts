// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Types
export type {
    ValidationError,
    ValidationResult,
    ScriptResult,
    FlowParameterDefinition,
    FlowSchemaEntry,
    FlowSchemaParameter,
} from "./types.js";

// Validation
export {
    createScriptValidator,
    transpileScript,
    BLOCKED_IDENTIFIERS,
    ALLOWED_GLOBALS,
} from "./validation/scriptValidator.js";
export type {
    ScriptValidatorConfig,
    ScriptValidator,
} from "./validation/scriptValidator.js";

// Execution
export { createScriptExecutor } from "./execution/scriptExecutor.js";
export type {
    ScriptExecutorConfig,
    ScriptExecutionOptions,
} from "./execution/scriptExecutor.js";

// Sandbox
export { createSandboxDeclarationGenerator } from "./sandbox/declarationGenerator.js";
export type { SandboxDeclarationConfig } from "./sandbox/declarationGenerator.js";

// Grammar
export {
    generateGrammarRuleText,
    extractRuleNames,
    buildStartRule,
    assembleDynamicGrammar,
} from "./grammar/grammarBuilder.js";
export type {
    GrammarPatternInput,
    GrammarEntry,
} from "./grammar/grammarBuilder.js";

export {
    computeTriggerPhrase,
    generateDefaultGrammarPatterns,
} from "./grammar/triggerPhrase.js";
export type {
    DefaultGrammarPattern,
    GrammarParameterInput,
    GenerateDefaultGrammarPatternsOptions,
} from "./grammar/triggerPhrase.js";

// Schema
export {
    generateFlowActionTypes,
    buildUnionType,
} from "./schema/schemaBuilder.js";

// Markdown helpers (for ActionResult display formatting)
export {
    INDENT,
    SECTION_BREAK,
    escapeMarkdown,
    escapeCodeSpan,
    formatTimestamp,
} from "./display/markdown.js";

// JSON helpers (strict + permissive array parsing)
export {
    tryParseJsonArray,
    parseOptionalJsonArray,
} from "./helpers/jsonHelpers.js";
export type { ParseResult } from "./helpers/jsonHelpers.js";

// Naming (free-form name → safe identifier + disambiguation)
export {
    tokenizeForTriggerPhrase,
    slugifyFlowName,
    resolveUniqueActionName,
} from "./authoring/naming.js";

// Tolerant LLM-response parser
export { parseFlowLLMResponse } from "./authoring/llmResponse.js";
export type {
    FlowLLMResponse,
    FlowLLMResponseOptions,
} from "./authoring/llmResponse.js";

// Action catalog + registry
export {
    parseActionCatalog,
    makeRegistry,
} from "./validation/actionCatalog.js";
export type {
    ActionRegistry,
    ActionCatalogOptions,
} from "./validation/actionCatalog.js";

// Static script analysis: unknown action detection
export {
    findUnknownActionCalls,
    formatUnknownActionError,
    closestActions,
    levenshtein,
} from "./validation/unknownActions.js";
export type {
    UnknownActionCall,
    FindUnknownActionsOptions,
} from "./validation/unknownActions.js";
