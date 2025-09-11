// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import { isProd } from "./index.js";
import { WebContents } from "electron";

export function loadLocalWebContents(
    webContents: WebContents,
    filePath: string,
) {
    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    if (!isProd && process.env["ELECTRON_RENDERER_URL"]) {
        // HMR
        return webContents.loadURL(
            `${process.env["ELECTRON_RENDERER_URL"]}/${filePath}`,
        );
    }
    return webContents.loadFile(path.join(__dirname, "../renderer", filePath));
}
