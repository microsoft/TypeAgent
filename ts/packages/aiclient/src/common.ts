// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Retrieve a setting from environment variables
 * @param env environment variables
 * @param key setting key
 * @param keySuffix additional suffix to add to key
 * @param defaultValue default value of setting
 * @returns
 */
export function getEnvSetting(
    env: Record<string, string | undefined>,
    key: string,
    keySuffix?: string,
    defaultValue?: string,
    requireSuffix: boolean = false,
): string {
    const envKey = keySuffix ? key + "_" + keySuffix : key;
    let value = env[envKey] ?? defaultValue;
    if (value === undefined && keySuffix) {
        if (!requireSuffix) {
            // Fallback to key without the suffix
            value = env[key];
        }
    }
    if (value === undefined) {
        throw new Error(`Missing ApiSetting: ${key}`);
    }
    return value;
}

export function appendNV(text: string, name: string, value?: any): string {
    if (text.length > 0) {
        text += "&";
    }
    if (value) {
        text += `${name}=${value}`;
    }
    return text;
}
