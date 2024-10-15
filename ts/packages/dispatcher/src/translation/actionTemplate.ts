// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Actions } from "agent-cache";
import { ActionInfo, TemplateParamObject } from "./actionInfo.js";

export type ActionTemplate = {
    agent: string;
    name: string;
    parameterStructure?: TemplateParamObject | undefined;
};

export type ActionTemplateSequence = {
    templates: ActionTemplate[];
    actions: unknown;
    preface?: string;
    editPreface?: string;
};

export function toTemplateSequence(
    actions: Actions,
    preface: string,
    editPreface: string,
    parameterStructures: Map<string, ActionInfo>,
): ActionTemplateSequence {
    const templates: ActionTemplate[] = [];

    for (const action of actions) {
        const actionInfo = parameterStructures.get(action.fullActionName);
        if (actionInfo === undefined) {
            throw new Error(
                `Action ${action.fullActionName} not found in parameterStructures`,
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
