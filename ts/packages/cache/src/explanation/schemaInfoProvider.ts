// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ParamSpec } from "action-schema";
import { ExecutableAction, FullAction } from "./requestAction.js";

export type ParamRange = {
    min: string;
    max: string;
    step: string;
    convertToInt?: boolean;
};

export function getParamRange(spec: ParamSpec): ParamRange | undefined {
    switch (spec) {
        case "ordinal":
            return { min: "1", max: "50", step: "1", convertToInt: true };
        case "percentage":
            return { min: "0", max: "50", step: "1", convertToInt: true };
        case "time":
            return { min: "12:00", max: "11:45", step: "00:15" };
    }
}

export function doCacheAction(
    action: ExecutableAction,
    schemaInfoProvider?: SchemaInfoProvider,
) {
    return schemaInfoProvider?.getActionCacheEnabled(
        action.action.schemaName,
        action.action.actionName,
    );
}

export function getParamSpec(
    action: FullAction,
    paramName: string,
    schemaInfoProvider?: SchemaInfoProvider,
): ParamSpec | undefined {
    return schemaInfoProvider?.getActionParamSpec(
        action.schemaName,
        action.actionName,
        paramName,
    );
}

export function getNamespaceForCache(
    schemaName: string,
    actionName: string,
    schemaInfoProvider?: SchemaInfoProvider,
): string {
    if (schemaInfoProvider?.getActionNamespace(schemaName) === true) {
        // REVIEW: this requires that subtranslator name doesn't conflict with actionName
        return `${schemaName}.${actionName}`;
    }

    return schemaName;
}

export type SchemaInfoProvider = {
    getActionParamSpec: (
        schemaName: string,
        actionName: string,
        paramName: string,
    ) => ParamSpec | undefined;

    getActionCacheEnabled: (schemaName: string, actionName: string) => boolean;
    getActionNamespace: (schemaName: string) => boolean | undefined; // default to false
    getActionSchemaFileHash: (schemaName: string) => string;
};
