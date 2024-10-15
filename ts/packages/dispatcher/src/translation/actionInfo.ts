// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ISymbol, SchemaParser, NodeType } from "schema-parser";
import {
    TranslatorConfig,
    TranslatorConfigProvider,
} from "./agentTranslators.js";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";

export type TemplateParamPrimitive = {
    type: "string" | "number" | "boolean";
};

export type TemplateParamStringUnion = {
    type: "string-union";
    typeEnum: string[];
};

export type TemplateParamScalar =
    | TemplateParamPrimitive
    | TemplateParamStringUnion;

export type TemplateParamArray = {
    type: "array";
    elementType: TemplateParamField;
};

export type TemplateParamObject = {
    type: "object";
    fields: {
        [key: string]: TemplateParamFieldOpt;
    };
};

export type TemplateParamFieldOpt = {
    optional?: boolean;
    field: TemplateParamField;
};

export type TemplateParamField =
    | TemplateParamScalar
    | TemplateParamObject
    | TemplateParamArray;

export type ActionInfo = {
    actionName: string;
    comments: string;
    parameters?: TemplateParamObject | undefined;
};

function getActionInfo(
    actionTypeName: string,
    parser: SchemaParser,
): ActionInfo | undefined {
    const node = parser.openActionNode(actionTypeName);
    if (node === undefined) {
        throw new Error(`Action type '${actionTypeName}' not found in schema`);
    }
    let actionName: string | undefined = undefined;
    let comments: string | undefined = undefined;
    let parameters: TemplateParamObject | undefined = undefined;
    for (const child of node.children) {
        if (child.symbol.name === "actionName") {
            // values are quoted.
            if (child.symbol.value === '"unknown"') {
                // TODO: Filter out unknown actions, we should make that invalidate at some point.
                return undefined;
            }
            actionName = child.symbol.value.slice(1, -1);
            comments = node.leadingComments?.join(" ") ?? "";
        } else if (child.symbol.name === "parameters") {
            parser.open(child.symbol.name);
            parameters = getTemplateParamObjectType(parser);
            parser.close();
        }
    }
    if (actionName !== undefined && comments !== undefined) {
        return {
            actionName,
            comments: node.leadingComments?.join(" ") ?? "",
            parameters,
        };
    }
    return undefined;
}

const translatorNameToActionInfo = new Map<string, ActionInfo[]>();

export function getTranslatorActionInfo(
    translatorConfig: TranslatorConfig,
    translatorName: string,
): ActionInfo[] {
    if (translatorNameToActionInfo.has(translatorName)) {
        return translatorNameToActionInfo.get(translatorName)!;
    } else {
        const parser = new SchemaParser();
        parser.loadSchema(getPackageFilePath(translatorConfig.schemaFile));

        const actionInfo: ActionInfo[] = [];
        for (const actionTypeName of parser.actionTypeNames()) {
            const info = getActionInfo(actionTypeName, parser);
            if (info) {
                actionInfo.push(info);
            }
        }
        translatorNameToActionInfo.set(translatorName, actionInfo);
        return actionInfo;
    }
}

export function getAllActionInfo(
    translatorNames: string[],
    provider: TranslatorConfigProvider,
) {
    let allActionInfo = new Map<string, ActionInfo>();
    for (const name of translatorNames) {
        const translatorConfig = provider.getTranslatorConfig(name);
        if (translatorConfig.injected) {
            continue;
        }
        const actionInfo = getTranslatorActionInfo(translatorConfig, name);
        for (const info of actionInfo) {
            const fullActionName = `${name}.${info.actionName}`;
            allActionInfo.set(fullActionName, info);
        }
    }
    return allActionInfo;
}

function getTemplateParamFieldType(
    parser: SchemaParser,
    param: ISymbol,
    valueType?: NodeType,
): TemplateParamField {
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
            const tree = getTemplateParamObjectType(parser);
            parser.close();
            return tree;
        case NodeType.Array:
            return {
                type: "array",
                elementType: getTemplateParamFieldType(
                    parser,
                    param,
                    param.valueType,
                ),
            };
        case NodeType.Property:
            return getTemplateParamFieldType(parser, param, param.valueType);
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
            const elementType = getTemplateParamObjectType(parser);
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
function getTemplateParamObjectType(parser: SchemaParser): TemplateParamObject {
    let fields: { [key: string]: any } = {};
    const paramChildren = parser.symbols();
    if (paramChildren !== undefined) {
        for (const param of paramChildren) {
            const fieldType = getTemplateParamFieldType(parser, param);
            fields[param.name] = {
                field: fieldType,
                optional: param.optional,
            };
        }
    }
    return {
        type: "object",
        fields,
    };
}
