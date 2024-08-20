// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { app } from "electron";
import registerDebug from "debug";
//import { readFileSync } from "fs";

const debugShell = registerDebug("typeagent:shell");

export class ShellSettings {
    private static instance: ShellSettings;
   
    public width: number = 900;
    public height: number = 1200;
    public x?: number = 0;
    public y?: number = 0;

    private constructor() {
        ShellSettings.loadSettings("sdlfjdsf");
    }

    public static getinstance = (): ShellSettings => {
        if (!ShellSettings.instance) {
            ShellSettings.instance = new ShellSettings();
        }

        return ShellSettings.instance;
    }

    private static loadSettings(filePath: string) {
        debugShell("Loading shell settings", performance.now());

        console.log(filePath);
        console.log(app.getPath("userData"));
        //readFileSync(filePath, "utf-8").toString();

        
    }
}