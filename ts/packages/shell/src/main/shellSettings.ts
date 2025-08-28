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
    DeepPartialUndefined,
    getObjectProperty,
    getObjectPropertyNames,
    setObjectProperty,
} from "common-utils";

export type { ShellUserSettings };

import { debugShell } from "./debug.js";

export type BrowserTabState = {
    id: string;
    url: string;
    title: string;
    isActive: boolean;
};

export type ShellWindowState = {
    x: number;
    y: number;
    // for use with horizontal layout
    chatWidth: number;
    contentWidth: number;
    windowHeight: number;
    // for use with vertical layout
    chatHeight: number;
    contentHeight: number;
    windowWidth: number;

    zoomLevel: number;
    devTools: boolean;
    canvas?: string; // should the canvas be reopen upon start?
    browserTabsJson?: string; // multi-tab browser state as JSON string
    activeBrowserTabId?: string; // which tab is active
};

type ShellSettings = {
    window: ShellWindowState;
    user: ShellUserSettings;
};

const defaultSettings: ShellSettings = {
    window: {
        x: -1,
        y: -1,
        chatWidth: 900,
        contentWidth: 1000,
        windowHeight: 1200,
        chatHeight: 230,
        contentHeight: 1000,
        windowWidth: 1200,
        zoomLevel: 1,
        devTools: false,
        canvas: undefined,
        browserTabsJson: undefined,
        activeBrowserTabId: undefined,
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

function getSettingsPath(instanceDir: string) {
    return path.join(getShellDataDir(instanceDir), "shellSettings.json");
}

export class ShellSettingManager {
    private readonly settings: ShellSettings;
    private readonly savedSettings: DeepPartialUndefined<ShellSettings>;
    constructor(private readonly instanceDir: string) {
        const settingsPath = getSettingsPath(instanceDir);
        debugShell(
            `Loading shell settings from '${settingsPath}'`,
            performance.now(),
        );

        const settings = cloneConfig(defaultSettings);
        this.settings = settings;
        this.savedSettings = {};
        if (existsSync(settingsPath)) {
            try {
                const existingSettings = JSON.parse(
                    readFileSync(settingsPath, "utf-8"),
                );
                this.savedSettings = existingSettings;
                mergeConfig(settings, existingSettings);
            } catch (e) {
                debugShell(`Error loading shell settings: ${e}`);
            }
        }

        debugShell(
            `Shell loaded settings: ${JSON.stringify(this.savedSettings, undefined, 2)}`,
        );
        debugShell(
            `Shell settings: ${JSON.stringify(this.settings, undefined, 2)}`,
        );
    }

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

        const defaultValue = getObjectProperty(defaultSettings.user, name);
        let newValue: any = value;
        if (value !== undefined) {
            const expectedType = typeof defaultValue; // The default value determines the type
            if (expectedType !== typeof value) {
                // Coerce the type
                switch (expectedType) {
                    case "string":
                    case "undefined": // undefined default means string
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
                            `Property '${name}' has unknown type ${expectedType} and cannot be set.`,
                        );
                }
            }
        }
        if (newValue === getObjectProperty(this.savedSettings.user, name)) {
            return false;
        }
        setObjectProperty(this.savedSettings, "user", name, newValue);
        setObjectProperty(
            this.settings,
            "user",
            name,
            newValue ?? defaultValue,
        );
        return true;
    }

    public save(windowState: ShellWindowState) {
        const settingsPath = getSettingsPath(this.instanceDir);
        debugShell(`Saving settings to '${settingsPath}'.`);

        const settings = this.savedSettings;
        settings.window = windowState;
        debugShell(JSON.stringify(settings, undefined, 2));
        writeFileSync(settingsPath, JSON.stringify(settings));
    }
}
