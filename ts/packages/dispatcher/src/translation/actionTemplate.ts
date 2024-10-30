// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Action, Actions } from "agent-cache";
import { getActionInfo, getTranslatorActionInfos } from "./actionInfo.js";
import { CommandHandlerContext } from "../internal.js";
import {
    TemplateFieldStringUnion,
    TemplateSchema,
    SessionContext,
    AppAction,
} from "@typeagent/agent-sdk";
import { getAppAgentName } from "./agentTranslators.js";
import { DeepPartialUndefined } from "common-utils";

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
                field: translatorName,
            },
        },
    };
    return template;
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
    const actionInfos = getTranslatorActionInfos(config, action.translatorName);
    const actionName: TemplateFieldStringUnion = {
        type: "string-union",
        typeEnum: Array.from(actionInfos.keys()),
        discriminator: "",
    };
    template.fields.actionName = {
        field: actionName,
    };

    const actionInfo = actionInfos.get(action.actionName);
    if (actionInfo === undefined) {
        return template;
    }
    actionName.discriminator = action.actionName;

    if (actionInfo.parameters) {
        template.fields.parameters = {
            // ActionParam types are compatible with TemplateFields
            field: actionInfo.parameters,
        };
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
    const actionInfo = getActionInfo(action, systemContext);
    if (actionInfo === undefined) {
        return [];
    }
    const appAgentName = getAppAgentName(actionInfo.translatorName);
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
