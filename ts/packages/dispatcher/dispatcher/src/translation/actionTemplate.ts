// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ExecutableAction, FullAction } from "@typeagent/agent-cache";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import {
    TemplateFieldStringUnion,
    TemplateSchema,
    SessionContext,
    TemplateType,
    TemplateFieldObject,
    TemplateFieldArray,
    TemplateFieldPrimitive,
} from "@typeagent/agent-sdk";
import type {
    TemplateData,
    TemplateEditConfig,
} from "@typeagent/dispatcher-types";
import {
    ActionParamArray,
    ActionParamObject,
    ActionParamType,
    resolveTypeReference,
} from "@typeagent/action-schema";
import { getActionParamCompletion } from "./requestCompletion.js";

function getDefaultActionTemplate(
    schemas: string[],
    discriminator: string = "",
): TemplateSchema {
    const schemaNames: TemplateFieldStringUnion = {
        type: "string-union",
        typeEnum: schemas,
        discriminator,
    };
    const template: TemplateSchema = {
        type: "object",
        fields: {
            schemaName: {
                type: schemaNames,
            },
        },
    };
    return template;
}

function resolveObjectType(
    type: ActionParamType,
): ActionParamObject | undefined {
    const resolved = resolveTypeReference(type);
    return resolved?.type === "object" ? resolved : undefined;
}

// Discriminated object union: shared single-value kind field.
function getObjectUnionDiscriminator(
    types: readonly ActionParamType[],
):
    | { fieldName: string; values: string[]; arms: ActionParamObject[] }
    | undefined {
    if (types.length < 2) {
        return undefined;
    }
    const arms: ActionParamObject[] = [];
    for (const t of types) {
        const obj = resolveObjectType(t);
        if (obj === undefined) {
            return undefined;
        }
        arms.push(obj);
    }

    const firstFields = Object.keys(arms[0].fields);
    for (const fieldName of firstFields) {
        const values: string[] = [];
        let ok = true;
        for (const arm of arms) {
            const field = arm.fields[fieldName];
            if (field === undefined || field.optional) {
                ok = false;
                break;
            }
            const ft = resolveTypeReference(field.type) ?? field.type;
            if (ft.type !== "string-union" || ft.typeEnum.length !== 1) {
                ok = false;
                break;
            }
            values.push(ft.typeEnum[0]);
        }
        if (!ok) {
            continue;
        }
        // Kind values must be unique per arm.
        if (new Set(values).size !== values.length) {
            continue;
        }
        return { fieldName, values, arms };
    }
    return undefined;
}

function toTemplateTypeObject(
    type: ActionParamObject,
    visited: ReadonlySet<string>,
    data: unknown,
) {
    const templateType: TemplateFieldObject = {
        type: "object",
        fields: {},
    };

    const dataObj =
        data !== null && typeof data === "object" && !Array.isArray(data)
            ? (data as Record<string, unknown>)
            : undefined;

    for (const [key, field] of Object.entries(type.fields)) {
        const fieldData = dataObj !== undefined ? dataObj[key] : undefined;
        const fieldType = toTemplateType(field.type, visited, fieldData);
        if (fieldType === undefined) {
            // Skip undefined fields.
            continue;
        }
        templateType.fields[key] = {
            optional: field.optional,
            type: fieldType,
        };
    }
    return templateType;
}

function toTemplateTypeArray(
    type: ActionParamArray,
    visited: ReadonlySet<string>,
    data: unknown,
) {
    // First array element shapes nested templates.
    const elementData =
        Array.isArray(data) && data.length > 0 ? data[0] : undefined;
    const elementType = toTemplateType(type.elementType, visited, elementData);
    if (elementType === undefined) {
        // Skip undefined fields.
        return undefined;
    }
    const templateType: TemplateFieldArray = {
        type: "array",
        elementType,
    };
    return templateType;
}

// Expand discriminated unions; else first-arm fallback.
function toTemplateTypeUnion(
    types: readonly ActionParamType[],
    visited: ReadonlySet<string>,
    data: unknown,
): TemplateType | undefined {
    const disc = getObjectUnionDiscriminator(types);
    if (disc !== undefined) {
        const { fieldName, values, arms } = disc;
        let selectedIndex = 0;
        if (
            data !== null &&
            typeof data === "object" &&
            !Array.isArray(data) &&
            fieldName in (data as object)
        ) {
            const current = (data as Record<string, unknown>)[fieldName];
            if (typeof current === "string") {
                const idx = values.indexOf(current);
                if (idx >= 0) {
                    selectedIndex = idx;
                }
            }
        }
        const selectedArm = arms[selectedIndex];
        const template = toTemplateTypeObject(selectedArm, visited, data);
        // Full kind enum; arm fields from data.
        template.fields[fieldName] = {
            optional: false,
            type: {
                type: "string-union",
                typeEnum: values,
                discriminator: values[selectedIndex],
            },
        };
        return template;
    }

    // Prefer arm that matches current data shape.
    if (data !== undefined) {
        for (const t of types) {
            const resolved = resolveTypeReference(t) ?? t;
            try {
                if (
                    resolved.type === "object" &&
                    data !== null &&
                    typeof data === "object" &&
                    !Array.isArray(data)
                ) {
                    return toTemplateType(t, visited, data);
                }
                if (resolved.type === "array" && Array.isArray(data)) {
                    return toTemplateType(t, visited, data);
                }
                if (
                    (resolved.type === "string" ||
                        resolved.type === "number" ||
                        resolved.type === "boolean" ||
                        resolved.type === "string-union") &&
                    typeof data === resolved.type
                ) {
                    return toTemplateType(t, visited, data);
                }
                if (
                    resolved.type === "string-union" &&
                    typeof data === "string"
                ) {
                    return toTemplateType(t, visited, data);
                }
            } catch {
                // try next arm
            }
        }
    }
    // Historical fallback: first arm.
    return toTemplateType(types[0], visited, data);
}

function toTemplateType(
    type: ActionParamType,
    visited: ReadonlySet<string> = new Set<string>(),
    data: unknown = undefined,
): TemplateType | undefined {
    switch (type.type) {
        case "type-union":
            return toTemplateTypeUnion(type.types, visited, data);
        case "type-reference":
            if (type.definition === undefined) {
                throw new Error(`Unresolved type reference: ${type.name}`);
            }
            if (visited.has(type.name)) {
                // Circular reference — skip to avoid infinite recursion.
                return undefined;
            }
            return toTemplateType(
                type.definition.type,
                new Set([...visited, type.name]),
                data,
            );
        case "object":
            return toTemplateTypeObject(type, visited, data);
        case "array":
            return toTemplateTypeArray(type, visited, data);
        case "string-union":
            return type as TemplateFieldStringUnion;
        case "string":
        case "number":
        case "boolean":
            return type as TemplateFieldPrimitive;
        case "undefined":
        case "any":
        case "true":
        case "false":
            // These have no editable template representation, so skip the field.
            return undefined;
        default: {
            const invalid: never = type;
            throw new Error(
                `Unknown type ${(invalid as ActionParamType).type}`,
            );
        }
    }
}
function toTemplate(
    context: CommandHandlerContext,
    schemas: string[],
    action: FullAction,
) {
    const actionSchemaFile = context.agents.tryGetActionSchemaFile(
        action.schemaName,
    );
    if (actionSchemaFile === undefined) {
        return getDefaultActionTemplate(schemas);
    }
    const template = getDefaultActionTemplate(schemas, action.schemaName);
    const actionSchemas = actionSchemaFile.parsedActionSchema.actionSchemas;
    const actionName: TemplateFieldStringUnion = {
        type: "string-union",
        typeEnum: Array.from(actionSchemas.keys()),
        discriminator: "",
    };
    template.fields.actionName = {
        type: actionName,
    };

    const actionSchema = actionSchemas.get(action.actionName);
    if (actionSchema === undefined) {
        return template;
    }
    actionName.discriminator = action.actionName;

    const actionParametersType = actionSchema.type.fields.parameters?.type;
    if (actionParametersType) {
        // Pass data so union arms resolve correctly.
        const type = toTemplateType(
            actionParametersType,
            new Set(),
            action.parameters,
        );
        if (type !== undefined) {
            template.fields.parameters = {
                // ActionParam types are compatible with TemplateFields
                type,
            };
        }
    }
    return template;
}

export function getActionTemplateEditConfig(
    context: CommandHandlerContext,
    actions: ExecutableAction[],
    preface: string,
    editPreface: string,
): TemplateEditConfig {
    const templateData: TemplateData[] = [];

    const schemas = context.agents.getActiveSchemas();
    for (const action of actions) {
        templateData.push({
            schema: toTemplate(context, schemas, action.action),
            data: action.action,
        });
    }

    return {
        templateAgentName: "system",
        templateName: "action",
        preface,
        editPreface,
        templateData,
        completion: true,
        defaultTemplate: getDefaultActionTemplate(schemas),
    };
}

function coerceToFullAction(data: unknown): FullAction {
    if (typeof data !== "object" || data === null) {
        return { schemaName: "", actionName: "" };
    }
    const result = data as FullAction;
    if (typeof result.schemaName !== "string") {
        result.schemaName = "";
    }
    if (typeof result.actionName !== "string") {
        result.actionName = "";
    }
    return result;
}

export async function getSystemTemplateSchema(
    templateName: string,
    data: unknown,
    context: SessionContext<CommandHandlerContext>,
): Promise<TemplateSchema> {
    if (templateName !== "action") {
        throw new Error(`Unknown template name: ${templateName}`);
    }

    const systemContext = context.agentContext;
    const schemas = systemContext.agents.getActiveSchemas();
    return toTemplate(systemContext, schemas, coerceToFullAction(data));
}

export async function getSystemTemplateCompletion(
    templateName: string,
    data: any,
    propertyName: string,
    context: SessionContext<CommandHandlerContext>,
): Promise<string[] | undefined> {
    if (templateName !== "action") {
        throw new Error(`Unknown template name: ${templateName}`);
    }

    if (!Array.isArray(data)) {
        return undefined;
    }

    const split = propertyName.split(".");
    const actionIndexStr = split.shift();
    if (actionIndexStr === undefined || split.length === 0) {
        // Not a valid property.
        return undefined;
    }
    const actionIndex = parseInt(actionIndexStr);
    if (actionIndex.toString() !== actionIndexStr) {
        // Not a valid number for action Index
        return undefined;
    }

    // TemplateData has the actual action in in the 'data' property
    const dataProperty = split.shift();
    if (dataProperty !== "data" || split.length === 0) {
        return undefined;
    }

    const parameterProperty = split.shift();
    if (parameterProperty !== "parameters" || split.length === 0) {
        return undefined;
    }
    const action = data[actionIndex];
    const systemContext = context.agentContext;

    const paramCompletion = await getActionParamCompletion(
        systemContext,
        action,
        split.join("."),
    );
    return paramCompletion?.completions;
}
