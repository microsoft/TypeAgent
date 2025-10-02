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

/**
 * Returns true if the given environment setting/key is available
 * @param key
 * @param keySuffix
 * @returns true if available, false otherwise
 */
export function hasEnvSettings(
    env: Record<string, string | undefined>,
    key: string,
    keySuffix?: string | undefined,
) {
    try {
        const setting = getEnvSetting(env, key, keySuffix, undefined, true);
        return setting !== undefined && setting.length > 0;
    } catch {}
    return false;
}

export function getIntFromEnv(
    env: Record<string, string | undefined>,
    envName: string,
    endpointName?: string,
    defaultValue?: number | undefined,
): number | undefined {
    const numString = getEnvSetting(env, envName, endpointName, "");
    if (!numString) {
        return defaultValue;
    }
    const num = parseInt(numString);

    if (num !== undefined && (num.toString() !== numString || num <= 0)) {
        throw new Error(`Invalid value for ${envName}: ${numString}`);
    }
    return num;
}
