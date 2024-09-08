// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { app } from "electron";
import registerDebug from "debug";
import { readFileSync, existsSync, writeFileSync } from "fs";
import path from "path";
import { defaultSettings, ShellSettingsType } from "./shellSettingsType.js";

const debugShell = registerDebug("typeagent:shell");

export class ShellSettings implements ShellSettingsType {
    private static instance: ShellSettings;

    public size: number[];
    public position?: number[];
    public zoomLevel: number;
    public devTools: boolean;
    public microphoneId?: string;
    public microphoneName?: string;
    public hideMenu: boolean;
    public hideTabs: boolean;
    public agentGreeting: boolean;
    public onSettingsChanged: (() => void) | null;

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
        this.agentGreeting = settings.agentGreeting;

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

        switch (t) {
            case "string":
                ShellSettings.getinstance()[name] = value;
                break;
            case "number":
                ShellSettings.getinstance()[name] = Number(value);
                break;
            case "boolean":
                ShellSettings.getinstance()[name] =
                    value.toLowerCase() === "true" || value === "1";
                break;
            case "object":
                ShellSettings.getinstance()[name] = JSON.parse(value);
                break;
        }

        if (ShellSettings.getinstance().onSettingsChanged) {
            ShellSettings.getinstance().onSettingsChanged!();
        }
    }
}
