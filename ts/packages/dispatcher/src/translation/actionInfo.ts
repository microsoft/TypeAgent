// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SchemaParser } from "schema-parser";
import { TranslatorConfig } from "./agentTranslators.js";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";

type ActionInfo = {
    name: string;
    comments: string;
};

function getActionInfo(
    actionTypeName: string,
    parser: SchemaParser,
): ActionInfo | undefined {
    const node = parser.openActionNode(actionTypeName);
    if (node === undefined) {
        throw new Error(`Action type '${actionTypeName}' not found in schema`);
    }
    for (const child of node.children) {
        if (child.symbol.name === "actionName") {
            // values are quoted.
            if (child.symbol.value === '"unknown"') {
                // TODO: Filter out unknown actions, we should make that invalidate at some point.
                return undefined;
            }
            return {
                name: child.symbol.value.slice(1, -1),
                comments: node.leadingComments?.join(" ") ?? "",
            };
        }
    }

    return undefined;
}

export function getTranslatorActionInfo(
    translatorConfig: TranslatorConfig,
): ActionInfo[] {
    const parser = new SchemaParser();
    parser.loadSchema(getPackageFilePath(translatorConfig.schemaFile));

    const actionInfo: ActionInfo[] = [];
    for (const actionTypeName of parser.actionTypeNames()) {
        const info = getActionInfo(actionTypeName, parser);
        if (info) {
            actionInfo.push(info);
        }
    }
    return actionInfo;
}
