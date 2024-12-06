// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export {
    SchemaType as ActionParamType,
    SchemaTypeArray as ActionParamArray,
    SchemaTypeObject as ActionParamObject,
    ActionSchemaTypeDefinition,
    ActionSchemaEntryTypeDefinition,
    ActionSchemaGroup,
    ActionSchemaFile,
    ActionSchemaObject,
    ActionSchemaUnion,
} from "./type.js";

export { parseActionSchemaSource } from "./parser.js";
export {
    GenerateSchemaOptions,
    generateActionSchema,
    generateSchemaTypeDefinition,
} from "./generator.js";
export { validateAction } from "./validate.js";
export { getParameterType, getParameterNames } from "./utils.js";

export { NodeType, SchemaParser, ISymbol, SymbolNode } from "./schemaParser.js";

export * as ActionSchemaCreator from "./creator.js";

export {
    ActionSchemaFileJSON,
    toJSONActionSchemaFile,
    fromJSONActionSchemaFile,
} from "./serialize.js";

// Schema Config
export { SchemaConfig, ParamSpec } from "./schemaConfig.js";
