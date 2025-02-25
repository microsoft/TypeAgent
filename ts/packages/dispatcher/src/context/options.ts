// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DeepPartialUndefinedAndNull } from "common-utils";

export function cloneConfig<T>(config: T): T {
    return structuredClone(config);
}

type ConfigObject = {
    [key: string]: ConfigObject | string | number | boolean | undefined;
};

type ConfigOptions = DeepPartialUndefinedAndNull<ConfigObject>;
/**
 * Merge options into config.
 *
 * @param config Config to merge into
 * @param options Options to change the config with
 * @param overwrite whether to overwrite the config even if the type mismatch. If an array is given, then those keys that the nested object will be overwritten when new types.
 * @param prefix Prefix for error message (for nested object)
 * @returns
 */
export function mergeConfig(
    config: ConfigObject,
    options: ConfigOptions,
    overwrite: string[] | boolean = false,
    prefix: string = "",
) {
    const changed: ConfigOptions = {};

    // Ignore extra properties when not overwrite by using the keys in config to
    // process option properties.
    const keys = Object.keys(overwrite === true ? options : config);
    for (const key of keys) {
        if (overwrite !== true && !options.hasOwnProperty(key)) {
            continue;
        }

        const optionValue = options[key];

        // undefined means no change
        if (optionValue === undefined) {
            continue;
        }
        // null means set it to undefined
        const value = optionValue === null ? undefined : optionValue;
        let existingValue = config[key];
        const overwriteKey = Array.isArray(overwrite)
            ? overwrite.includes(key)
            : overwrite;
        if (!overwriteKey && typeof existingValue !== typeof value) {
            throw new Error(
                `Invalid option '${key}': type mismatch (expected: ${typeof existingValue}, actual: ${typeof value})`,
            );
        }
        if (typeof value === "object") {
            if (typeof existingValue !== "object") {
                // overwrite existing config as an object. for non-strictKey
                existingValue = {};
                config[key] = existingValue;
            }

            const changedValue = mergeConfig(
                existingValue,
                value,
                overwriteKey,
                `${prefix}${key}.`,
            );
            if (Object.keys(changedValue).length !== 0) {
                changed[key] = changedValue;
            }
        } else if (existingValue !== value) {
            if (!overwriteKey && value === undefined) {
                delete config[key];
            } else {
                config[key] = value;
            }
            changed[key] = optionValue;
        }
    }
    return changed;
}

export function sanitizeConfig(
    config: ConfigObject,
    options: ConfigOptions,
    strict: string[] | boolean = true,
    prefix: string = "",
) {
    let changed = false;
    for (const [key, value] of Object.entries(options)) {
        if (value === null) {
            // Serialized options can't have a null value.
            throw new Error(`Invalid option: '${prefix}${key}' cannot be null`);
        }
        if (value === undefined || !config.hasOwnProperty(key)) {
            // Ignore options with no effect and extraneous options.
            continue;
        }
        const existingValue = config[key];
        const strictKey = Array.isArray(strict)
            ? !strict.includes(key)
            : strict;
        if (strictKey && typeof existingValue !== typeof value) {
            // Clear value for mismatched types.
            delete options[key];
            changed = true;
            continue;
        }

        if (typeof existingValue === "object" && typeof value === "object") {
            if (
                sanitizeConfig(
                    existingValue,
                    value,
                    strictKey,
                    `${prefix}${key}.`,
                )
            ) {
                changed = true;
            }
        }
    }
    return changed;
}
