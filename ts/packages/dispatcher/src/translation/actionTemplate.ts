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

export type ActionTemplateSequence = {
    templateAppAgent: string;
    templateName: string;
    templates: TemplateSchema[];
    actions: unknown[];
    preface?: string;
    editPreface?: string;
};

function toTemplate(
    context: CommandHandlerContext,
    translators: string[],
    action: Action,
) {
    const translatorName: TemplateFieldStringUnion = {
        type: "string-union",
        typeEnum: translators,
    };
    const template: TemplateSchema = {
        type: "object",
        fields: {
            translatorName: {
                field: translatorName,
            },
        },
    };
    const config = context.agents.getTranslatorConfig(action.translatorName);

    if (config === undefined) {
        return template;
    }
    translatorName.discriminator = action.translatorName;

    const actionInfos = getTranslatorActionInfos(config, action.translatorName);
    const actionName: TemplateFieldStringUnion = {
        type: "string-union",
        typeEnum: Array.from(actionInfos.keys()),
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

export function toTemplateSequence(
    context: CommandHandlerContext,
    actions: Actions,
    preface: string,
    editPreface: string,
): ActionTemplateSequence {
    const templates: TemplateSchema[] = [];

    const translators = getActiveTranslatorList(context);
    for (const action of actions) {
        templates.push(toTemplate(context, translators, action));
    }

    return {
        templateAppAgent: "system",
        templateName: "action",
        preface,
        editPreface,
        actions: actions.toFullActions(),
        templates,
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
    return toTemplate(
        systemContext,
        getActiveTranslatorList(systemContext),
        data,
    );
}
