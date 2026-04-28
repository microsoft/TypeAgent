// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import lockfile from "proper-lockfile";
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

/**
 * Acquire a synchronous lock on the user data directory, matching the
 * locking pattern in userData.ts.
 */
function lockUserSettings<T>(fn: () => T): T {
    let release: () => void;
    try {
        release = lockfile.lockSync(getUserDataDir());
    } catch (error: any) {
        console.error(
            `ERROR: Unable to lock user data directory: ${error.message}. Exiting.`,
        );
        process.exit(-1);
    }
    try {
        return fn();
    } finally {
        release();
    }
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

function cloneDefaults(): UserSettings {
    return structuredClone(defaultUserSettings);
}

/**
 * Load user settings, merging saved values over defaults.
 * Acquires a file lock to prevent concurrent read/write races.
 */
export function loadUserSettings(): UserSettings {
    return lockUserSettings(() => {
        const filePath = getUserSettingsFilePath();
        try {
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, "utf-8");
                const saved = JSON.parse(content);
                return deepMerge(cloneDefaults(), saved);
            }
        } catch {
            // Fall through to defaults on any read/parse error
        }
        return cloneDefaults();
    });
}

/**
 * Save a partial settings update, deep-merging with existing saved settings.
 * Acquires a file lock so concurrent writers don't corrupt state.
 */
export function saveUserSettings(
    partial: DeepPartialUndefined<UserSettings>,
): UserSettings {
    return lockUserSettings(() => {
        const filePath = getUserSettingsFilePath();
        // Read current inside the lock to get a consistent snapshot
        let current: UserSettings;
        try {
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, "utf-8");
                const saved = JSON.parse(content);
                current = deepMerge(cloneDefaults(), saved);
            } else {
                current = cloneDefaults();
            }
        } catch {
            current = cloneDefaults();
        }

        const merged = deepMerge(current, partial as Record<string, any>);
        ensureDirectory(path.dirname(filePath));
        fs.writeFileSync(filePath, JSON.stringify(merged, null, 2) + "\n");
        return merged;
    });
}

/**
 * Reset all user settings to defaults by removing the settings file.
 * Acquires a file lock for consistency.
 */
export function resetUserSettings(): UserSettings {
    return lockUserSettings(() => {
        const filePath = getUserSettingsFilePath();
        try {
            fs.unlinkSync(filePath);
        } catch {
            // Ignore if already gone
        }
        return cloneDefaults();
    });
}
