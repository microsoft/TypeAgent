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
        const p = Promise.withResolvers<void>();
        const navListener = (
            _: Electron.Event,
            url: string,
            httpResponseCode: number,
            httpStatusText: string,
        ) => {
            if (httpResponseCode === 200) {
                p.resolve();
            } else {
                p.reject(
                    new Error(
                        `Failed to load URL: ${url}, status: ${httpResponseCode} ${httpStatusText}`,
                    ),
                );
            }
            webContents.removeListener("did-navigate", navListener);
        };
        webContents.addListener("did-navigate", navListener);

        webContents
            .loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/${filePath}`)
            .catch((err) => {
                p.reject(err);
            });
        return p.promise;
    }
    return webContents.loadFile(path.join(__dirname, "../renderer", filePath));
}
