// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { app } from "electron";
import registerDebug from "debug";
import { readFileSync, existsSync, writeFileSync } from "fs";
import path from "path";

const debugShell = registerDebug("typeagent:shell");

export class ShellSettings {
    private static instance: ShellSettings;

    public size?: number[] = [900, 1200];
    public position?: number[];
    public zoomLevel: number = 1;
    public devTools?: boolean = false;
    public microphoneId?: string;
    public microphoneName?: string;
    public hideMenu?: boolean = true;

    public get width(): number | undefined {
        return this.size ? this.size[0] : undefined;
    }

    public get height(): number | undefined {
        return this.size ? this.size[1] : undefined;
    }

    public get x(): number | undefined {
        return this.position ? this.position[0] : undefined;
    }

    public get y(): number | undefined {
        return this.position ? this.position[1] : undefined;
    }

    private constructor() {
        let settings = ShellSettings.load();

        if (settings) {
            if (settings.size) {
                this.size = settings.size;
            }

            this.position = settings.position;
            this.zoomLevel = settings.zoomLevel;
            this.devTools = settings.devTools;
            this.microphoneId = settings.microphoneId;
            this.microphoneName = settings.microphoneName;
            this.hideMenu = settings.hideMenu;
        }
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

    private static load(): any {
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
}
