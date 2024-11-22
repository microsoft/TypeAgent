// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export {
    SchemaType as ActionParamType,
    SchemaTypeArray as ActionParamArray,
    SchemaTypeObject as ActionParamObject,
    ActionSchemaTypeDefinition,
    ActionSchemaEntryTypeDefinition,
    ActionSchemaFile,
    ActionSchemaObject,
    ActionSchemaUnion,
} from "./type.js";

export { parseActionSchemaFile, parseActionSchemaSource } from "./parser.js";
export {
    generateActionSchema,
    generateSchemaTypeDefinition,
} from "./generator.js";
export { validateAction } from "./validate.js";
export { getParameterType, getParameterNames } from "./utils.js";

export { NodeType, SchemaParser, ISymbol, SymbolNode } from "./schemaParser.js";

export * as ActionSchemaCreator from "./creator.js";
