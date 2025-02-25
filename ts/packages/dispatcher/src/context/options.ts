// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DeepPartialUndefined,
    DeepPartialUndefinedAndNull,
} from "common-utils";

export function cloneConfig<T>(config: T): T {
    return structuredClone(config);
}

// Full config
type ConfigObject = {
    [key: string]: ConfigObject | string | number | boolean;
};

// Settings that can be serialized, with undefined values indicating default.
type ConfigSettings = DeepPartialUndefined<ConfigObject>;

// Config changed, with missing value indicating no change (and undefined values are changed);
type ConfigChanged = DeepPartialUndefined<ConfigObject> | undefined;

// Changes to be applied to the settings, with null values indicating removal and undefined indicating no change.
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
    config: ConfigSettings,
    options: ConfigOptions,
    overwrite: string[] | boolean = false,
    defaultConfig?: ConfigObject,
    prefix: string = "",
): ConfigChanged {
    const changed: ConfigSettings = {};

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
        const defaultValue = defaultConfig?.[key];
        const value = optionValue === null ? defaultValue : optionValue;
        let existingValue = config[key];
        const overwriteKey = Array.isArray(overwrite)
            ? overwrite.includes(key)
            : overwrite;
        if (!overwriteKey && typeof existingValue !== typeof value) {
            throw new Error(
                `Invalid option '${prefix}${key}': type mismatch (expected: ${typeof existingValue}, actual: ${typeof value})`,
            );
        }
        if (typeof value === "object") {
            if (typeof existingValue !== "object") {
                // overwrite existing config as an object. for non-strictKey
                existingValue = {};
                config[key] = existingValue;
            }

            if (
                defaultValue !== undefined &&
                typeof defaultValue !== "object"
            ) {
                throw new Error(
                    `Invalid option '${prefix}${key}': default value is not an object`,
                );
            }
            const changedValue = mergeConfig(
                existingValue,
                value,
                overwriteKey,
                defaultValue,
                `${prefix}${key}.`,
            );
            if (changedValue) {
                changed[key] = changedValue;
            }
        } else if (existingValue !== value) {
            if (!overwriteKey && value === undefined) {
                delete config[key];
            } else {
                config[key] = value;
            }
            changed[key] = value;
        }
    }

    return Object.keys(changed).length !== 0 ? changed : undefined;
}

