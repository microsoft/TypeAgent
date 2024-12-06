// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { simpleStarRegex } from "common-utils";
import { Actions } from "./requestAction.js";
import { SchemaConfig, ParamSpec } from "action-schema";

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
    config: SchemaConfig | undefined,
    actionName: string,
) {
    return config?.paramSpec?.[actionName] !== false;
}

export function getParamSpec(
    config: SchemaConfig | undefined,
    actionName: string,
    paramName: string,
): ParamSpec | undefined {
    if (config === undefined) {
        return undefined;
    }
    const specs = config?.paramSpec?.[actionName];
    if (typeof specs !== "object") {
        return undefined;
    }

    for (const [key, value] of Object.entries(specs)) {
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
    config: SchemaConfig | undefined,
    translatorName: string,
    actionName: string,
): string {
    if (config?.actionNamespace === true) {
        // REVIEW: this requires that subtranslator name doesn't conflict with actionName
        return `${translatorName}.${actionName}`;
    }

    return translatorName;
}

export type SchemaConfigProvider = (
    translatorName: string,
) => SchemaConfig | undefined;

export function getConstructionInfo(
    actions: Actions,
    getSchemaConfig?: SchemaConfigProvider,
) {
    const action = actions.action;
    if (action === undefined) {
        throw new Error("Multiple action not supported.");
    }
    const translatorName = action.translatorName;
    if (translatorName === undefined) {
        throw new Error("Construction not support without translator name");
    }
    const translatorSchemaConfig = getSchemaConfig?.(translatorName);

    const namespace = getNamespaceForCache(
        translatorSchemaConfig,
        translatorName,
        action.actionName,
    );

    return { translatorSchemaConfig, namespace };
}
