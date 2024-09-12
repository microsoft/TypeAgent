// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { app } from "electron";
import registerDebug from "debug";
import { readFileSync, existsSync, writeFileSync } from "fs";
import path from "path";
import {
    defaultSettings,
    ShellSettingsType,
    TTSSettings,
} from "./shellSettingsType.js";
import {
    ClientSettingsProvider,
    EmptyFunction,
} from "../preload/electronTypes.js";

const debugShell = registerDebug("typeagent:shell");

export class ShellSettings
    implements ShellSettingsType, ClientSettingsProvider
{
    private static instance: ShellSettings;

    public size: number[];
    public position?: number[];
    public zoomLevel: number;
    public devTools: boolean;
    public microphoneId?: string;
    public microphoneName?: string;
    public hideMenu: boolean;
    public hideTabs: boolean;
    public notifyFilter: string;
    public tts: boolean;
    public ttsSettings: TTSSettings;
    public agentGreeting: boolean;
    public multiModalContent: boolean;
    public onSettingsChanged: EmptyFunction | null;

    public get width(): number | undefined {
        return this.size[0];
    }

    public get height(): number | undefined {
        return this.size[1];
    }

    public get x(): number | undefined {
        return this.position ? this.position[0] : undefined;
    }

    public get y(): number | undefined {
        return this.position ? this.position[1] : undefined;
    }

    private constructor() {
        const settings: ShellSettingsType = {
            ...defaultSettings,
            ...ShellSettings.load(),
        };

        this.size = settings.size;
        this.position = settings.position;
        this.zoomLevel = settings.zoomLevel;
        this.devTools = settings.devTools;
        this.microphoneId = settings.microphoneId;
        this.microphoneName = settings.microphoneName;
        this.hideMenu = settings.hideMenu;
        this.hideTabs = settings.hideTabs;
        this.notifyFilter = settings.notifyFilter;
        this.tts = settings.tts;
        this.ttsSettings = settings.ttsSettings;
        this.agentGreeting = settings.agentGreeting;
        this.multiModalContent = settings.multiModalContent;

        this.onSettingsChanged = null;
    }

    public static get filePath(): string {
        return path.join(app.getPath("userData"), "shellSettings.json");
    }

    public static getinstance = (): ShellSettings => {
        if (!ShellSettings.instance) {
            ShellSettings.instance = new ShellSettings();
        }

        return ShellSettings.instance;
    };

    private static load(): Partial<ShellSettingsType> | null {
        debugShell(
            `Loading shell settings from '${this.filePath}'`,
            performance.now(),
        );

        if (existsSync(this.filePath)) {
            return JSON.parse(readFileSync(this.filePath, "utf-8"));
        }

        return null;
    }

    public save() {
        debugShell(
            `Saving settings to '${ShellSettings.filePath}'.`,
            performance.now(),
        );

        writeFileSync(ShellSettings.filePath, JSON.stringify(this));
    }

    public set(name: string, value: any) {
        const t = typeof ShellSettings.getinstance()[name];

        if (t === typeof value) {
            ShellSettings.getinstance()[name] = value;
        } else {
            switch (t) {
                case "string":
                    ShellSettings.getinstance()[name] = value;
                    break;
                case "number":
                    ShellSettings.getinstance()[name] = Number(value);
                    break;
                case "boolean":
                    if (typeof value === t) {
                    }
                    ShellSettings.getinstance()[name] =
                        value.toLowerCase() === "true" || value === "1";
                    break;
                case "object":
                    ShellSettings.getinstance()[name] = JSON.parse(value);
                    break;
            }
        }

        if (ShellSettings.getinstance().onSettingsChanged != null) {
            ShellSettings.getinstance().onSettingsChanged!();
        }
    }
}
