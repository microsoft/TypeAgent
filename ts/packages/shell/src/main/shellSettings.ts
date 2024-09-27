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
    public notifyFilter: string;
    public tts: boolean;
    public ttsSettings: TTSSettings;
    public agentGreeting: boolean;
    public multiModalContent: boolean;
    public devUI: boolean;
    public partialCompletion: boolean;
    public onSettingsChanged: EmptyFunction | null;
    public onShowSettingsDialog: ((dialogName: string) => void) | null;
    public onRunDemo: ((interactive: boolean) => void) | null;
    public onToggleTopMost: EmptyFunction | null;

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

    private constructor(settings: ShellSettingsType | null = null) {
        if (settings === null) {
            settings = {
                ...defaultSettings,
                ...ShellSettings.load(),
            };
        }

        this.size = settings.size;
        this.position = settings.position;
        this.zoomLevel = settings.zoomLevel;
        this.devTools = settings.devTools;
        this.microphoneId = settings.microphoneId;
        this.microphoneName = settings.microphoneName;
        this.notifyFilter = settings.notifyFilter;
        this.tts = settings.tts;
        this.ttsSettings = settings.ttsSettings;
        this.agentGreeting = settings.agentGreeting;
        this.multiModalContent = settings.multiModalContent;
        this.devUI = settings.devUI;
        this.partialCompletion = settings.partialCompletion;

        this.onSettingsChanged = null;
        this.onShowSettingsDialog = null;
        this.onRunDemo = null;
        this.onToggleTopMost = null;
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

    public getSerializable(): ShellSettings {
        return new ShellSettings(ShellSettings.getinstance());
    }

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

    public show(dialogName: string = "settings") {
        if (ShellSettings.getinstance().onShowSettingsDialog != null) {
            ShellSettings.getinstance().onShowSettingsDialog!(dialogName);
        }
    }

    public runDemo(interactive: boolean = false) {
        if (ShellSettings.getinstance().onRunDemo != null) {
            ShellSettings.getinstance().onRunDemo!(interactive);
        }
    }

    public toggleTopMost() {
        if (ShellSettings.getinstance().onToggleTopMost != null) {
            ShellSettings.getinstance().onToggleTopMost!();
        }
    }
}
