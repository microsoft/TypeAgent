// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { simpleStarRegex } from "common-utils";
import { ParamSpec, ActionParamSpecs } from "action-schema";
import { Action } from "./requestAction.js";

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
    schemaConfigProvider: SchemaConfigProvider | undefined,
    action: Action,
) {
    return (
        schemaConfigProvider?.getActionParamSpecs(
            action.translatorName,
            action.actionName,
        ) !== false
    );
}

export function getParamSpec(
    schemaConfigProvider: SchemaConfigProvider | undefined,
    action: Action,
    paramName: string,
): ParamSpec | undefined {
    const paramSpecs = schemaConfigProvider?.getActionParamSpecs(
        action.translatorName,
        action.actionName,
    );

    if (typeof paramSpecs !== "object") {
        return undefined;
    }

    for (const [key, value] of Object.entries(paramSpecs)) {
        if (key.includes("*")) {
            const regex = simpleStarRegex(key);
            if (regex.test(paramName)) {
                return value;
            }
        } else if (key === paramName) {
            return value;
        }
    }
}

export function getNamespaceForCache(
    schemaConfigProvider: SchemaConfigProvider | undefined,
    schemaName: string,
    actionName: string,
): string {
    if (schemaConfigProvider?.getActionNamespace(schemaName) === true) {
        // REVIEW: this requires that subtranslator name doesn't conflict with actionName
        return `${schemaName}.${actionName}`;
    }

    return schemaName;
}

export type SchemaConfigProvider = {
    getActionParamSpecs: (
        schemaName: string,
        actionName: string,
    ) => ActionParamSpecs | undefined;
    getActionNamespace: (schemaName: string) => boolean | undefined; // default to false
};
