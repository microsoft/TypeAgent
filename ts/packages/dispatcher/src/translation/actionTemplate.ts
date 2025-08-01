// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ExecutableAction, FullAction } from "agent-cache";
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
import {
    ActionParamArray,
    ActionParamObject,
    ActionParamType,
} from "action-schema";
import { getActionParamCompletion } from "./requestCompletion.js";

export type TemplateData = {
    schema: TemplateSchema;
    data: unknown;
};
export type TemplateEditConfig = {
    templateAgentName: string;
    templateName: string;
    templateData: TemplateData | TemplateData[];
    defaultTemplate: TemplateSchema;
    preface?: string;
    editPreface?: string;
    completion?: boolean;
};

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

function toTemplateTypeObject(type: ActionParamObject) {
    const templateType: TemplateFieldObject = {
        type: "object",
        fields: {},
    };

    for (const [key, field] of Object.entries(type.fields)) {
        const type = toTemplateType(field.type);
        if (type === undefined) {
            // Skip undefined fields.
            continue;
        }
        templateType.fields[key] = { optional: field.optional, type };
    }
    return templateType;
}

function toTemplateTypeArray(type: ActionParamArray) {
    const elementType = toTemplateType(type.elementType);
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

function toTemplateType(type: ActionParamType): TemplateType | undefined {
    switch (type.type) {
        case "type-union":
            // TODO: smarter about type unions.
            return toTemplateType(type.types[0]);
        case "type-reference":
            // TODO: need to handle circular references (or error on circular references)
            if (type.definition === undefined) {
                throw new Error(`Unresolved type reference: ${type.name}`);
            }
            return toTemplateType(type.definition.type);
        case "object":
            return toTemplateTypeObject(type);
        case "array":
            return toTemplateTypeArray(type);
        case "undefined":
            return undefined;
        case "string":
        case "number":
        case "boolean":
            return type as TemplateFieldPrimitive;
        default:
            throw new Error(`Unknown type ${type.type}`);
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
        const type = toTemplateType(actionParametersType);
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

    return getActionParamCompletion(systemContext, action, split.join("."));
}
