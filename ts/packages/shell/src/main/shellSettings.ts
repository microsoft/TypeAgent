// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import { readFileSync, existsSync, writeFileSync } from "fs";
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

const debugShell = registerDebug("typeagent:shell");

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

export function getSettingsPath(instanceDir: string) {
    return path.join(instanceDir, "shellSettings.json");
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
    ) {}

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
                case "undefined": // undefined is assume to be string only
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
