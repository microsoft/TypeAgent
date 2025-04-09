// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import { readFileSync, existsSync, writeFileSync } from "fs";
import {
    defaultSettings,
    ShellSettingsType,
    TTSSettings,
} from "../preload/shellSettingsType.js";
import { ClientSettingsProvider } from "../preload/electronTypes.js";
import { getInstanceDir } from "agent-dispatcher/helpers/data";
import path from "path";
import { DisplayType } from "@typeagent/agent-sdk";

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
    public disallowedDisplayType: DisplayType[];
    public onSettingsChanged: ((name?: string | undefined) => void) | null;
    public darkMode: boolean;
    public chatHistory: boolean;
    public canvas?: string;

    public get width(): number {
        return this.size[0] ?? defaultSettings.size[0];
    }

    public get height(): number {
        return this.size[1] ?? defaultSettings.size[1];
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
        this.disallowedDisplayType = settings.disallowedDisplayType;

        this.onSettingsChanged = null;
        this.darkMode = settings.darkMode;
        this.chatHistory = settings.chatHistory;
        this.canvas = settings.canvas;
    }

    public static get filePath(): string {
        return path.join(getInstanceDir(), "shellSettings.json");
    }

    public static getinstance = (): ShellSettings => {
        if (!ShellSettings.instance) {
            ShellSettings.instance = new ShellSettings();
        }

        return ShellSettings.instance;
    };

    public getSerializable(): ShellSettings {
        return new ShellSettings(this);
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
        debugShell(`Saving settings to '${ShellSettings.filePath}'.`);
        debugShell(JSON.stringify(this, undefined, 2));
        writeFileSync(ShellSettings.filePath, JSON.stringify(this));
    }

    public set(name: string, value: any) {
        const t = typeof this[name];
        const oldValue = this[name];
        if (t === typeof value) {
            this[name] = value;
        } else {
            switch (t) {
                case "string":
                    this[name] = value;
                    break;
                case "number":
                    this[name] = Number(value);
                    break;
                case "boolean":
                    this[name] =
                        value.toLowerCase() === "true" || value === "1";
                    break;
                case "object":
                case "undefined":
                    this[name] = JSON.parse(value);
                    break;
            }
        }

        if (this.onSettingsChanged != null && oldValue != value) {
            this.onSettingsChanged!(name);
        }
    }

    public isDisplayTypeAllowed(displayType: DisplayType): boolean {
        for (let i = 0; i < this.disallowedDisplayType.length; i++) {
            if (this.disallowedDisplayType[i] === displayType) {
                return true;
            }
        }

        return false;
    }
}
