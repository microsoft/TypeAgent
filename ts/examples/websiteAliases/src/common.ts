// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { exec } from "node:child_process";

export const keywordSiteMapFile: string =
    "examples/websiteAliases/keyword_to_sites.json";
export const resolvedKeyWordFile: string =
    "examples/websiteAliases/resolvedKeywords.json";

export async function closeChrome(): Promise<void> {
    return new Promise<void>((resolve) => {
        let command = "";

        // Determine the command based on the operating system
        if (process.platform === "win32") {
            command = "taskkill /F /IM chrome.exe /T";
        } else if (process.platform === "darwin") {
            command = 'pkill -9 "Google Chrome"';
        } else {
            command = "pkill -9 chrome";
        }

        console.log(`Attempting to close Chrome with command: ${command}`);

        exec(command, (error: any, stdout: string, stderr: string) => {
            if (error) {
                console.log(
                    `Chrome may not be running or couldn't be closed: ${error.message}`,
                );
            }

            if (stderr) {
                console.log(`Chrome close error output: ${stderr}`);
            }

            if (stdout) {
                console.log(`Chrome closed successfully: ${stdout}`);
            }

            resolve();
        });
    });
}

export function getRandomDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}