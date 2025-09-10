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

export function isValidActionSchemaFileHash(
    provider: SchemaInfoProvider,
    schemaName: string,
    hash: string | undefined,
) {
    if (hash === undefined) {
        return false;
    }

    try {
        const fileHash = provider.getActionSchemaFileHash(schemaName);
        return fileHash === hash;
    } catch {
        // Schema not found
        return false;
    }
}

export type SchemaInfoProvider = {
    // Throws if schemaName or actionName not found
    getActionParamSpec: (
        schemaName: string,
        actionName: string,
        paramName: string,
    ) => ParamSpec | undefined;

    // Throws if schemaName or actionName not found
    getActionCacheEnabled: (schemaName: string, actionName: string) => boolean;

    // Throws if schemaName not found
    getActionNamespace: (schemaName: string) => boolean | undefined; // default to false

    // Throws if schemaName not found
    getActionSchemaFileHash: (schemaName: string) => string;
};
