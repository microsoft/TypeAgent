// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ISymbol, NodeType, SchemaParser } from "./schemaParser.js";
import {
    ActionParamObject,
    ActionParamObjectFields,
    ActionParamType,
    ActionSchema,
} from "./type.js";

function getActionParamFieldType(
    parser: SchemaParser,
    param: ISymbol,
    valueType?: NodeType,
): ActionParamType {
    let type = param.type;
    if (valueType !== undefined) {
        type = valueType;
    }
    switch (type) {
        case NodeType.String:
            return { type: "string" };
        case NodeType.Numeric:
            return { type: "number" };
        case NodeType.Boolean:
            return { type: "boolean" };
        case NodeType.Object:
        case NodeType.Interface:
        case NodeType.TypeReference:
            parser.open(param.name);
            const tree = getActionParamObjectType(parser);
            parser.close();
            return tree;
        case NodeType.Array:
            return {
                type: "array",
                elementType: getActionParamFieldType(
                    parser,
                    param,
                    param.valueType,
                ),
            };
        case NodeType.Property:
            return getActionParamFieldType(parser, param, param.valueType);
        case NodeType.Union:
            if (param.valueType === NodeType.String) {
                return {
                    type: "string-union",
                    // remove quotes and split by pipe
                    typeEnum: param.value
                        .split("|")
                        .map((v) => v.trim().slice(1, -1)),
                };
            }
            break;
        case NodeType.ObjectArray:
            parser.open(param.name);
            const elementType = getActionParamObjectType(parser);
            parser.close();
            return {
                type: "array",
                elementType,
            };
        default:
            console.log(`Unhandled type ${param.type}`);
    }
    return { type: "string" };
}

// assumes parser is open to the correct parameter object
function getActionParamObjectType(parser: SchemaParser): ActionParamObject {
    let fields: ActionParamObjectFields = {};
    const paramChildren = parser.symbols();
    if (paramChildren !== undefined) {
        for (const param of paramChildren) {
            const fieldType = getActionParamFieldType(parser, param);
            fields[param.name] = {
                type: fieldType,
                optional: param.optional,
            };
        }
    }
    return {
        type: "object",
        fields,
    };
}

function parseActionSchema(
    translatorName: string,
    actionTypeName: string,
    parser: SchemaParser,
): ActionSchema | undefined {
    const node = parser.openActionNode(actionTypeName);
    if (node === undefined) {
        throw new Error(`Action type '${actionTypeName}' not found in schema`);
    }
    let actionName: string | undefined = undefined;
    let comments: string[] | undefined = undefined;
    let parameters: ActionParamObject | undefined = undefined;
    for (const child of node.children) {
        if (child.symbol.name === "actionName") {
            // values are quoted.
            if (child.symbol.value === '"unknown"') {
                // TODO: Filter out unknown actions, we should make that invalidate at some point.
                return undefined;
            }
            actionName = child.symbol.value.slice(1, -1);
            comments = node.leadingComments;
        } else if (child.symbol.name === "parameters") {
            parser.open(child.symbol.name);
            parameters = getActionParamObjectType(parser);
            parser.close();
        }
    }
    if (actionName !== undefined) {
        return {
            translatorName,
            typeName: actionTypeName,
            actionName,
            comments,
            parameters,
        };
    }
    return undefined;
}

export function parseActionSchemaFile(
    filename: string,
    translatorName: string,
) {
    const parser = new SchemaParser();
    parser.loadSchema(filename);

    const actionInfo = new Map<string, ActionSchema>();
    for (const actionTypeName of parser.actionTypeNames()) {
        const info = parseActionSchema(translatorName, actionTypeName, parser);
        if (info) {
            actionInfo.set(info.actionName, info);
        }
    }
    return actionInfo;
}
