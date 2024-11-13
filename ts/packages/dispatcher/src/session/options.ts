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
            let value = options[key];
            if (value === undefined) {
                continue;
            }
            if (value === null) {
                // null means undefined
                value = undefined;
            }
            let configValue = config[key];
            const strictKey = flexKeys ? !flexKeys.includes(key) : strict;
            if (strictKey && typeof configValue !== typeof value) {
                // Ignore invalid options.
                continue;
            }
            if (typeof value === "object") {
                if (typeof configValue !== "object") {
                    configValue = {};
                    config[key] = configValue;
                }

                const changedValue = mergeConfig(configValue, value, strictKey);
                if (Object.keys(changedValue).length !== 0) {
                    changed[key] = changedValue;
                }
            } else if (
                configValue !== value &&
                (!strict || config.hasOwnProperty(key))
            ) {
                if (!strict && value === undefined) {
                    delete config[key];
                } else {
                    config[key] = value;
                }
                changed[key] = value;
            }
        }
    }
    return changed;
}
