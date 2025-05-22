// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export {
    ResolvedSchemaType as ActionResolvedParamType,
    SchemaType as ActionParamType,
    SchemaTypeArray as ActionParamArray,
    SchemaTypeObject as ActionParamObject,
    ActionSchemaTypeDefinition,
    ActionSchemaEntryTypeDefinition,
    ActionSchemaGroup,
    ParsedActionSchema,
    ActionSchemaObject,
    ActionSchemaUnion,
} from "./type.js";

export { parseActionSchemaSource } from "./parser.js";
export {
    GenerateSchemaOptions,
    generateActionSchema,
    generateSchemaTypeDefinition,
} from "./generator.js";
export { parseToolsJsonSchema } from "./jsonSchemaParser.js";
export {
    generateActionJsonSchema,
    generateActionActionFunctionJsonSchemas,
    ActionObjectJsonSchema,
    ActionFunctionJsonSchema,
} from "./jsonSchemaGenerator.js";
export { validateAction } from "./validate.js";
export {
    getParameterType,
    getParameterNames,
    resolveTypeReference,
    resolveUnionType,
} from "./utils.js";

export * as ActionSchemaCreator from "./creator.js";

export {
    ParsedActionSchemaJSON,
    toJSONParsedActionSchema,
    fromJSONParsedActionSchema,
} from "./serialize.js";

// Generic (non-action) Schema
export { validateType } from "./validate.js";

// Schema Config
export { SchemaConfig, ParamSpec, ActionParamSpecs } from "./schemaConfig.js";

// Legacy (to be deprecated)
export { NodeType, SchemaParser, ISymbol, SymbolNode } from "./schemaParser.js";
