// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Action, Actions } from "agent-cache";
import { getActionSchema, getTranslatorActionSchemas } from "./actionSchema.js";
import { CommandHandlerContext } from "../internal.js";
import {
    TemplateFieldStringUnion,
    TemplateSchema,
    SessionContext,
    AppAction,
    TemplateType,
    TemplateFieldObject,
    TemplateFieldArray,
    TemplateFieldPrimitive,
} from "@typeagent/agent-sdk";
import { getAppAgentName } from "./agentTranslators.js";
import { DeepPartialUndefined } from "common-utils";
import {
    ActionParamArray,
    ActionParamObject,
    ActionParamType,
} from "action-schema";

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
    translators: string[],
    discriminator: string = "",
): TemplateSchema {
    const translatorName: TemplateFieldStringUnion = {
        type: "string-union",
        typeEnum: translators,
        discriminator,
    };
    const template: TemplateSchema = {
        type: "object",
        fields: {
            translatorName: {
                type: translatorName,
            },
        },
    };
    return template;
}

function toTemplateTypeObject(type: ActionParamObject, value: any) {
    const templateType: TemplateFieldObject = {
        type: "object",
        fields: {},
    };

    for (const [key, field] of Object.entries(type.fields)) {
        const type = toTemplateType(field.type, value[key]);
        if (type === undefined) {
            // Skip undefined fileds.
            continue;
        }
        templateType.fields[key] = { optional: field.optional, type };
    }
    return templateType;
}

function toTemplateTypeArray(type: ActionParamArray, value: any) {
    const elementType = toTemplateType(type.elementType, value[0]);
    if (elementType === undefined) {
        // Skip undefined fileds.
        return undefined;
    }
    const templateType: TemplateFieldArray = {
        type: "array",
        elementType,
    };
    return templateType;
}

function toTemplateType(
    type: ActionParamType,
    value: any,
): TemplateType | undefined {
    switch (type.type) {
        case "type-union":
            // TODO: smarter about type unions.
            return toTemplateType(type.types[0], value);
        case "type-reference":
            // TODO: need to handle circular references (or error on circular references)
            return toTemplateType(type.definition.type, value);
        case "object":
            return toTemplateTypeObject(type, value);
        case "array":
            return toTemplateTypeArray(type, value[0]);
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
    translators: string[],
    action: Action,
) {
    const config = context.agents.tryGetTranslatorConfig(action.translatorName);
    if (config === undefined) {
        return getDefaultActionTemplate(translators);
    }
    const template = getDefaultActionTemplate(
        translators,
        action.translatorName,
    );
    const actionInfos = getTranslatorActionSchemas(
        config,
        action.translatorName,
    );
    const actionSchemas = actionInfos.actionSchemaMap;
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

    const parameterType = actionSchema.type.fields.parameters?.type;
    if (parameterType) {
        const type = toTemplateType(parameterType, action.parameters);
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
    actions: Actions,
    preface: string,
    editPreface: string,
): TemplateEditConfig {
    const templateData: TemplateData[] = [];

    const translators = context.agents.getActiveTranslators();
    for (const action of actions) {
        templateData.push({
            schema: toTemplate(context, translators, action),
            data: action.toFullAction(),
        });
    }

    return {
        templateAgentName: "system",
        templateName: "action",
        preface,
        editPreface,
        templateData,
        completion: true,
        defaultTemplate: getDefaultActionTemplate(translators),
    };
}

export async function getSystemTemplateSchema(
    templateName: string,
    data: any,
    context: SessionContext<CommandHandlerContext>,
): Promise<TemplateSchema> {
    if (templateName !== "action") {
        throw new Error(`Unknown template name: ${templateName}`);
    }

    const systemContext = context.agentContext;

    // check user input to make sure it is an action

    if (typeof data.translatorName !== "string") {
        data.translatorName = "";
    }

    if (typeof data.actionName !== "string") {
        data.actionName = "";
    }

    const translators = systemContext.agents.getActiveTranslators();
    return toTemplate(systemContext, translators, data);
}

export async function getSystemTemplateCompletion(
    templateName: string,
    data: any,
    propertyName: string,
    context: SessionContext<CommandHandlerContext>,
): Promise<string[]> {
    if (templateName !== "action") {
        throw new Error(`Unknown template name: ${templateName}`);
    }

    if (!Array.isArray(data)) {
        return [];
    }

    const split = propertyName.split(".");
    const actionIndexStr = split.shift();
    if (actionIndexStr === undefined || split.length === 0) {
        // Not a valid property.
        return [];
    }
    const actionIndex = parseInt(actionIndexStr);
    if (actionIndex.toString() !== actionIndexStr) {
        // Not a valid number for action Index
        return [];
    }

    // TemplateData has the actual action in in the 'data' property
    const dataProperty = split.shift();
    if (dataProperty !== "data" || split.length === 0) {
        return [];
    }

    const action = data[actionIndex];
    const systemContext = context.agentContext;
    return getActionCompletion(systemContext, action, split.join("."));
}

export async function getActionCompletion(
    systemContext: CommandHandlerContext,
    action: DeepPartialUndefined<AppAction>,
    propertyName: string,
): Promise<string[]> {
    const actionSchema = getActionSchema(action, systemContext.agents);
    if (actionSchema === undefined) {
        return [];
    }
    const appAgentName = getAppAgentName(action.translatorName!);
    const appAgent = systemContext.agents.getAppAgent(appAgentName);
    if (appAgent.getActionCompletion === undefined) {
        return [];
    }

    const sessionContext = systemContext.agents.getSessionContext(appAgentName);
    return appAgent.getActionCompletion(
        action as AppAction,
        propertyName,
        sessionContext,
    );
}
