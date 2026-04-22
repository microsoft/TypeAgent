// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { DeepPartialUndefined } from "@typeagent/common-utils";
import { getUserDataDir } from "./userData.js";
import { ensureDirectory } from "../utils/fsUtils.js";

export interface UserSettings {
    server: {
        hidden: boolean;
        idleTimeout: number;
    };
    conversation: {
        resume: boolean;
    };
}

export const defaultUserSettings: UserSettings = {
    server: {
        hidden: false,
        idleTimeout: 0,
    },
    conversation: {
        resume: false,
    },
};

function getUserSettingsFilePath(): string {
    return path.join(getUserDataDir(), "user-settings.json");
}

const unsafeKeys = new Set(["__proto__", "constructor", "prototype"]);

function deepMerge<T extends Record<string, any>>(
    target: T,
    source: Record<string, any>,
): T {
    const result = { ...target };
    for (const key of Object.keys(source) as (keyof T)[]) {
        if (unsafeKeys.has(key as string)) {
            continue;
        }
        const sourceVal = source[key as string];
        if (
            sourceVal !== undefined &&
            typeof sourceVal === "object" &&
            sourceVal !== null &&
            !Array.isArray(sourceVal) &&
            typeof result[key] === "object" &&
            result[key] !== null
        ) {
            result[key] = deepMerge(
                result[key] as Record<string, any>,
                sourceVal as Record<string, any>,
            ) as T[keyof T];
        } else if (sourceVal !== undefined) {
            result[key] = sourceVal as T[keyof T];
        }
    }
    return result;
}

/**
 * Load user settings, merging saved values over defaults.
 */
export function loadUserSettings(): UserSettings {
    const filePath = getUserSettingsFilePath();
    try {
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, "utf-8");
            const saved = JSON.parse(content);
            return deepMerge(structuredClone(defaultUserSettings), saved);
        }
    } catch {
        // Fall through to defaults on any read/parse error
    }
    return {
        ...defaultUserSettings,
        server: { ...defaultUserSettings.server },
        conversation: { ...defaultUserSettings.conversation },
    };
}

/**
 * Save a partial settings update, deep-merging with existing saved settings.
 */
export function saveUserSettings(
    partial: DeepPartialUndefined<UserSettings>,
): UserSettings {
    const filePath = getUserSettingsFilePath();
    const current = loadUserSettings();
    const merged = deepMerge(current, partial as Record<string, any>);

    ensureDirectory(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(merged, null, 2) + "\n");
    return merged;
}

/**
 * Reset all user settings to defaults by removing the settings file.
 */
export function resetUserSettings(): UserSettings {
    const filePath = getUserSettingsFilePath();
    try {
        fs.unlinkSync(filePath);
    } catch {
        // Ignore if already gone
    }
    return {
        ...defaultUserSettings,
        server: { ...defaultUserSettings.server },
        conversation: { ...defaultUserSettings.conversation },
    };
}
