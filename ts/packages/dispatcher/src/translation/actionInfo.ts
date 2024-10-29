// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ISymbol, SchemaParser, NodeType } from "schema-parser";
import { TranslatorConfig } from "./agentTranslators.js";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";
import { FullAction } from "agent-cache";
import { AppAction } from "@typeagent/agent-sdk";
import { CommandHandlerContext } from "../internal.js";
import { DeepPartialUndefined } from "common-utils";

export type ActionParamPrimitive = {
    type: "string" | "number" | "boolean";
};

export type ActionParamStringUnion = {
    type: "string-union";
    typeEnum: string[];
};

export type ActionParamScalar = ActionParamPrimitive | ActionParamStringUnion;

export type ActionParamArray = {
    type: "array";
    elementType: ActionParamField;
};

export type ActionParamObject = {
    type: "object";
    fields: {
        [key: string]: ActionParamFieldOpt;
    };
};

export type ActionParamFieldOpt = {
    optional?: boolean;
    field: ActionParamField;
};

export type ActionParamField =
    | ActionParamScalar
    | ActionParamObject
    | ActionParamArray;

export type ActionInfo = {
    translatorName: string;
    actionName: string;
    comments: string;
    parameters?: ActionParamObject | undefined;
};

function parseActionInfo(
    translatorName: string,
    actionTypeName: string,
    parser: SchemaParser,
): ActionInfo | undefined {
    const node = parser.openActionNode(actionTypeName);
    if (node === undefined) {
        throw new Error(`Action type '${actionTypeName}' not found in schema`);
    }
    let actionName: string | undefined = undefined;
    let comments: string | undefined = undefined;
    let parameters: ActionParamObject | undefined = undefined;
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
            parameters = getActionParamObjectType(parser);
            parser.close();
        }
    }
    if (actionName !== undefined && comments !== undefined) {
        return {
            translatorName,
            actionName,
            comments,
            parameters,
        };
    }
    return undefined;
}

// Global Cache
const translatorNameToActionInfo = new Map<string, Map<string, ActionInfo>>();

export function getTranslatorActionInfos(
    translatorConfig: TranslatorConfig,
    translatorName: string,
): Map<string, ActionInfo> {
    if (translatorNameToActionInfo.has(translatorName)) {
        return translatorNameToActionInfo.get(translatorName)!;
    }
    const parser = new SchemaParser();
    parser.loadSchema(getPackageFilePath(translatorConfig.schemaFile));

    const actionInfo = new Map<string, ActionInfo>();
    for (const actionTypeName of parser.actionTypeNames()) {
        const info = parseActionInfo(translatorName, actionTypeName, parser);
        if (info) {
            actionInfo.set(info.actionName, info);
        }
    }
    translatorNameToActionInfo.set(translatorName, actionInfo);
    return actionInfo;
}

function getActionParamFieldType(
    parser: SchemaParser,
    param: ISymbol,
    valueType?: NodeType,
): ActionParamField {
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
    let fields: { [key: string]: any } = {};
    const paramChildren = parser.symbols();
    if (paramChildren !== undefined) {
        for (const param of paramChildren) {
            const fieldType = getActionParamFieldType(parser, param);
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

function validateField(
    name: string,
    expected: ActionParamField,
    actual: unknown,
    coerce: boolean,
) {
    if (actual === null) {
        throw new Error(`Field ${name} is null`);
    }
    switch (expected.type) {
        case "object":
            if (typeof actual !== "object" || Array.isArray(actual)) {
                throw new Error(`Field ${name} is not an object: ${actual}`);
            }
            validateObject(
                name,
                expected,
                actual as Record<string, unknown>,
                coerce,
            );
            break;
        case "array":
            if (!Array.isArray(actual)) {
                throw new Error(`Field ${name} is not an array: ${actual}`);
            }
            validateArray(name, expected, actual, coerce);
            break;
        case "string-union":
            if (typeof actual !== "string") {
                throw new Error(`Field ${name} is not a string: ${actual}`);
            }
            if (!expected.typeEnum.includes(actual)) {
                throw new Error(`Field ${name} is not in the enum: ${actual}`);
            }
            break;
        default:
            if (typeof actual !== expected.type) {
                if (coerce && typeof actual === "string") {
                    switch (expected.type) {
                        case "number":
                            const num = parseInt(actual);
                            if (num.toString() === actual) {
                                return actual;
                            }
                            break;
                        case "boolean":
                            if (actual === "true") {
                                return true;
                            }
                            if (actual === "false") {
                                return false;
                            }
                            break;
                    }
                }
                throw new Error(
                    `Property ${name} is not a ${expected.type}: ${actual}`,
                );
            }
    }
}

function validateArray(
    name: string,
    expected: ActionParamArray,
    actual: unknown[],
    coerce: boolean = false,
) {
    for (let i = 0; i < actual.length; i++) {
        const element = actual[i];
        const v = validateField(
            `${name}.${i}`,
            expected.elementType,
            element,
            coerce,
        );
        if (coerce && v !== undefined) {
            actual[i] = v;
        }
    }
}

function validateObject(
    name: string,
    expected: ActionParamObject,
    actual: Record<string, unknown>,
    coerce: boolean,
) {
    for (const field of Object.entries(expected.fields)) {
        const [fieldName, fieldInfo] = field;
        const actualField = actual[fieldName];
        const fullName = `${name}.${fieldName}`;
        if (actualField === undefined) {
            if (!fieldInfo.optional) {
                throw new Error(`Missing required field ${fullName}`);
            }
            continue;
        }
        const v = validateField(
            `${name}.${fieldName}`,
            fieldInfo.field,
            actualField,
            coerce,
        );
        if (coerce && v !== undefined) {
            actual[fieldName] = v;
        }
    }
}

export function validateAction(
    actionInfo: ActionInfo,
    action: Record<string, unknown>,
    coerce: boolean = false,
): action is FullAction {
    if (actionInfo.actionName !== action.actionName) {
        throw new Error(
            `Action name '${actionInfo.actionName}' expected, got '${action.actionName}' instead`,
        );
    }

    const parameters = action.parameters;
    if (parameters === undefined) {
        throw new Error("Missing parameter property");
    }

    if (
        parameters === null ||
        typeof parameters !== "object" ||
        Array.isArray(parameters)
    ) {
        throw new Error("Parameter object not an object");
    }

    if (actionInfo.parameters === undefined) {
        const keys = Object.keys(parameters);
        if (keys.length > 0) {
            throw new Error(
                `Action has extraneous parameters : ${keys.join(", ")}`,
            );
        }
        return true;
    }

    validateObject(
        "parameters",
        actionInfo.parameters,
        parameters as Record<string, unknown>,
        coerce,
    );
    return true;
}

export function getParameterNames(
    actionInfo: ActionInfo,
    getCurrentValue: (name: string) => any,
) {
    if (actionInfo.parameters === undefined) {
        return [];
    }
    const pending: Array<[string, ActionParamField]> = [
        ["parameters", actionInfo.parameters],
    ];
    const result: string[] = [];
    while (true) {
        const next = pending.pop();
        if (next === undefined) {
            return result;
        }

        const [name, field] = next;
        switch (field.type) {
            case "object":
                for (const [key, value] of Object.entries(field.fields)) {
                    pending.push([`${name}.${key}`, value.field]);
                }
                break;
            case "array":
                const v = getCurrentValue(name);
                const newIndex = Array.isArray(v) ? v.length : 0;
                for (let i = 0; i <= newIndex; i++) {
                    pending.push([`${name}.${i}`, field.elementType]);
                }
                break;
            default:
                result.push(name);
        }
    }
}

export function getParameterType(actionInfo: ActionInfo, name: string) {
    const propertyNames = name.split(".");
    if (propertyNames.shift() !== "parameters") {
        return undefined;
    }
    let curr: ActionParamField | undefined = actionInfo.parameters;
    if (curr === undefined) {
        return undefined;
    }

    for (const propertyName of propertyNames) {
        const maybeIndex = parseInt(propertyName);
        if (maybeIndex.toString() == propertyName) {
            if (curr.type !== "array") {
                return undefined;
            }
            curr = curr.elementType;
        } else {
            if (curr.type !== "object") {
                return undefined;
            }
            curr = curr.fields[propertyName]?.field;
            if (curr === undefined) {
                return undefined;
            }
        }
    }
    return curr;
}

export function getActionInfo(
    action: DeepPartialUndefined<AppAction>,
    systemContext: CommandHandlerContext,
) {
    const { translatorName, actionName } = action;
    if (translatorName === undefined || actionName === undefined) {
        return undefined;
    }
    const config = systemContext.agents.tryGetTranslatorConfig(translatorName);
    if (config === undefined) {
        return undefined;
    }

    const actionInfos = getTranslatorActionInfos(config, translatorName);
    return actionInfos.get(actionName);
}
