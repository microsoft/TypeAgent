// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import {
    defaultUserSettings,
    ShellUserSettings,
} from "../preload/shellSettingsType.js";
import { cloneConfig, mergeConfig } from "agent-dispatcher/helpers/config";

import { ReadonlyDeep } from "type-fest";
import path from "path";
import {
    getObjectProperty,
    getObjectPropertyNames,
    setObjectProperty,
} from "common-utils";

export type { ShellUserSettings };

import { debugShell } from "./debug.js";

export type ShellWindowState = {
    x: number;
    y: number;
    width: number;
    height: number;
    inlineWidth: number;
    zoomLevel: number;
    devTools: boolean;
    canvas?: string; // should the canvas be reopenend upon start?
};

export type ShellSettings = {
    window: ShellWindowState;
    user: ShellUserSettings;
};

export const defaultSettings: ShellSettings = {
    window: {
        x: -1,
        y: -1,
        width: 900,
        height: 1200,
        inlineWidth: 1000,
        zoomLevel: 1,
        devTools: false,
        canvas: undefined,
    },

    user: defaultUserSettings,
};

export function getShellDataDir(instanceDir: string) {
    return path.join(instanceDir, "shell");
}

export function ensureShellDataDir(instanceDir: string) {
    const shellDataDir = getShellDataDir(instanceDir);
    if (!existsSync(shellDataDir)) {
        debugShell(`Creating shell data directory '${shellDataDir}'`);
        mkdirSync(shellDataDir, { recursive: true });
    }
    return shellDataDir;
}

export function getSettingsPath(instanceDir: string) {
    return path.join(getShellDataDir(instanceDir), "shellSettings.json");
}

export function loadShellSettings(instanceDir: string): ShellSettings {
    const settingsPath = getSettingsPath(instanceDir);
    debugShell(
        `Loading shell settings from '${settingsPath}'`,
        performance.now(),
    );
    const settings = cloneConfig(defaultSettings);
    if (existsSync(settingsPath)) {
        try {
            const existingSettings = JSON.parse(
                readFileSync(settingsPath, "utf-8"),
            );
            mergeConfig(settings, existingSettings);
        } catch (e) {
            debugShell(`Error loading shell settings: ${e}`);
        }
    }
    debugShell(`Shell settings: ${JSON.stringify(settings, undefined, 2)}`);
    return settings;
}

export class ShellSettingManager {
    constructor(
        private readonly settings: ShellSettings,
        private readonly instanceDir: string,
    ) { }

    public get window(): ReadonlyDeep<ShellWindowState> {
        return this.settings.window;
    }
    public get user(): ReadonlyDeep<ShellUserSettings> {
        return this.settings.user;
    }
    public setUserSettings(userSettings: ShellUserSettings) {
        this.settings.user = userSettings;
    }

    public setUserSettingValue(name: string, value: unknown) {
        if (typeof value === "object" && value !== null) {
            let changed = false;
            for (const [k, v] of Object.entries(value)) {
                if (this.setUserSettingValue(`${name}.${k}`, v)) {
                    changed = true;
                }
            }
            return changed;
        }
        const names = getObjectPropertyNames(this.settings.user);
        // Only allow setting leaf properties.
        if (!names.includes(name)) {
            throw new Error(`Invalid property name '${name}'.`);
        }
        const currentValue = getObjectProperty(this.settings.user, name);
        let newValue: any = value;
        let valueType = typeof currentValue;
        if (valueType !== typeof value) {
            // Coerce the type
            switch (valueType) {
                case "string":
                    if (value === undefined) {
                        // use default value to determine if the value is optional
                        const defaultValue = getObjectProperty(
                            defaultSettings,
                            name,
                        );
                        if (defaultValue !== undefined) {
                            throw new Error(
                                `Invalid undefined for property '${name}`,
                            );
                        }
                        break;
                    }
                case "undefined": // only allow optional on string types
                    newValue = String(value);
                    break;

                case "number":
                    newValue = Number(value);
                    if (isNaN(newValue)) {
                        throw new Error(
                            `Invalid number value '${value}' for property '${name}'.`,
                        );
                    }
                    break;
                case "boolean":
                    switch (value) {
                        case "true":
                        case "1":
                            newValue = true;
                            break;
                        case "false":
                        case "0":
                            newValue = false;
                            break;
                        default:
                            throw new Error(
                                `Invalid boolean value '${value}' for property '${name}'.`,
                            );
                    }
                    break;
                default:
                    throw new Error(
                        `Property '${name}' has unknown type ${valueType} and cannot be set.`,
                    );
            }
        }

        if (newValue === currentValue) {
            return false;
        }
        setObjectProperty(this.settings, "user", name, newValue);
        return true;
    }

    public save(windowState: ShellWindowState) {
        const settingsPath = getSettingsPath(this.instanceDir);
        debugShell(`Saving settings to '${settingsPath}'.`);

        const settings = this.settings;
        settings.window = windowState;
        debugShell(JSON.stringify(settings, undefined, 2));
        writeFileSync(settingsPath, JSON.stringify(settings));
    }
}
