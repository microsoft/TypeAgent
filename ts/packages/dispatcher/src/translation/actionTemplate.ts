// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Actions } from "agent-cache";
import { ActionParamObject, getTranslatorActionInfos } from "./actionInfo.js";
import { TranslatorConfigProvider } from "./agentTranslators.js";

export type ActionTemplate = {
    agent: string;
    name: string;
    parameterStructure?: ActionParamObject | undefined;
};

export type ActionTemplateSequence = {
    templates: ActionTemplate[];
    actions: unknown;
    preface?: string;
    editPreface?: string;
};

export function toTemplateSequence(
    provider: TranslatorConfigProvider,
    actions: Actions,
    preface: string,
    editPreface: string,
): ActionTemplateSequence {
    const templates: ActionTemplate[] = [];

    for (const action of actions) {
        const config = provider.getTranslatorConfig(action.translatorName);
        const actionInfos = getTranslatorActionInfos(
            config,
            action.translatorName,
        );
        const actionInfo = actionInfos.get(action.actionName);
        if (actionInfo === undefined) {
            throw new Error(
                `ActionInfo for '${action.fullActionName}' not found`,
            );
        }
        templates.push({
            parameterStructure: actionInfo.parameters,
            name: action.actionName,
            agent: action.translatorNameString,
        });
    }

    return {
        preface,
        editPreface,
        actions: actions.toFullActions(),
        templates,
    };
}
