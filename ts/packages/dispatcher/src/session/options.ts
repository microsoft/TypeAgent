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
export function mergeConfig(
    config: ConfigObject,
    options: ConfigOptions,
    strict: boolean = true,
    flexKeys?: string[],
) {
    const changed: ConfigOptions = {};
    const keys = strict ? Object.keys(config) : Object.keys(options);
    for (const key of keys) {
        if (options.hasOwnProperty(key)) {
            const value = options[key];
            if (value === undefined) {
                continue;
            }
            if (value !== null && typeof value === "object") {
                const strictKey = flexKeys ? !flexKeys.includes(key) : strict;
                let configValue = config[key];
                if (
                    configValue === undefined ||
                    typeof configValue !== "object"
                ) {
                    if (strictKey) {
                        // Ignore invalid options.
                        continue;
                    }
                    configValue = {};
                    config[key] = configValue;
                }

                const changedValue = mergeConfig(configValue, value, strictKey);
                if (Object.keys(changedValue).length !== 0) {
                    changed[key] = changedValue;
                }
            } else if (!config.hasOwnProperty(key) || config[key] !== value) {
                config[key] = value === null ? undefined : value;
                changed[key] = value;
            }
        }
    }
    return changed;
}
