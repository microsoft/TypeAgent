// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    FlagValueTypes,
    FlagDefinition,
    FlagDefinitions,
} from "../parameters.js";

function getTypeFromValue(value?: FlagValueTypes) {
    if (value === undefined) {
        return "string";
    }
    if (Array.isArray(value)) {
        const element = value[0];
        if (Array.isArray(element)) {
            throw new Error(
                `Invalid nested array default value for flag definition`,
            );
        }
        return getTypeFromValue(element);
    }

    return typeof value as "string" | "number" | "boolean";
}

export function getFlagMultiple(def: FlagDefinition) {
    return def.multiple ?? Array.isArray(def.default);
}
export function getFlagType(def: FlagDefinition) {
    return def.type ?? getTypeFromValue(def.default);
}

export function resolveFlag(
    definitions: FlagDefinitions,
    flag: string,
): [string, FlagDefinition] | undefined {
    if (flag.startsWith("--")) {
        const key = flag.substring(2);
        const def = definitions[key];
        return def !== undefined ? [key, def] : undefined;
    }
    if (flag.startsWith("-")) {
        const alias = flag.substring(1);
        for (const [key, def] of Object.entries(definitions)) {
            if (def?.char === alias) {
                return [key, def];
            }
        }
    }
}
