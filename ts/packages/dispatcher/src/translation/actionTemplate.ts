// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Action, Actions } from "agent-cache";
import { getTranslatorActionInfos } from "./actionInfo.js";
import { CommandHandlerContext } from "../internal.js";
import { getActiveTranslatorList } from "../handlers/common/commandHandlerContext.js";
import {
    TemplateFieldStringUnion,
    TemplateSchema,
    SessionContext,
} from "@typeagent/agent-sdk";

export type TemplateData = {
    schema: TemplateSchema;
    data: unknown;
};
export type TemplateEditConfig = {
    templateAppAgent: string;
    templateName: string;
    templateData: TemplateData | TemplateData[];
    defaultTemplate: TemplateSchema;
    preface?: string;
    editPreface?: string;
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

    const translators = getActiveTranslatorList(context);
    for (const action of actions) {
        templateData.push({
            schema: toTemplate(context, translators, action),
            data: action.toFullAction(),
        });
    }

    return {
        templateAppAgent: "system",
        templateName: "action",
        preface,
        editPreface,
        templateData,
        defaultTemplate: getDefaultActionTemplate(translators),
    };
}

export function getSystemTemplateSchema(
    templateName: string,
    data: any,
    context: SessionContext<CommandHandlerContext>,
): TemplateSchema {
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

    const translators = getActiveTranslatorList(systemContext);
    return toTemplate(systemContext, translators, data);
}
