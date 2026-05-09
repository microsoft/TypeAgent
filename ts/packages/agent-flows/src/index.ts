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

// Schema
export {
    generateFlowActionTypes,
    buildUnionType,
} from "./schema/schemaBuilder.js";
