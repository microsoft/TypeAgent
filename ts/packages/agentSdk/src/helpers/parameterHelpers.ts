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

    const type = typeof value;
    if (type === "object") {
        return "json";
    }
    return type as "string" | "number" | "boolean";
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
        if (def !== undefined) {
            return [key, def];
        }
        const split = key.split(".");
        if (split.length > 1) {
            const def = definitions[split[0]];
            if (def?.type === "json") {
                return [split[0], def];
            }
        }
        return undefined;
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
