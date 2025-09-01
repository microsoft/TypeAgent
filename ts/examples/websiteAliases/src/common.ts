// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import chalk from "chalk";
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

/**
 * Checks if a page is available by making a request.
 * @param url - The URL to check
 * @returns True if there was a semi-valid response from the server, false otherwise
 */
export async function isPageAvailable(url: string): Promise<boolean> {
    let retryCount = 0;
    const MAX_RETRIES = 3;

    // HTTPS
    do {
        try {

            if (!url.startsWith("http") || !url.startsWith("https")) {
                url = `https://${url}`;
            }
            
            const httpsResponse = await fetch(`${url}`);
            const httpsStatus = httpsResponse.status;

            if (httpsResponse.ok || httpsStatus === 400) {
                return true;
            }

            const httpsText = await httpsResponse.text();
            console.log(
                `HTTPS ${chalk.red(httpsStatus)}\n${chalk.red(httpsText.substring(0, 20))}`,
            );

            break;
        } catch (error: any) {
            console.error(
                chalk.red(
                    `Error checking page availability ${url}: ${error?.message}`,
                ),
            );

            // name not found
            if (
                error.cause.code === "ENOTFOUND" ||
                error.cause.code === "UND_ERR_CONNECT_TIMEOUT"
            ) {
                break;
            }

            await new Promise((resolve) => setTimeout(resolve, 500));
        } finally {
            retryCount++;
        }
    } while (retryCount < MAX_RETRIES);

    retryCount = 0;

    // fallback to HTTP
    do {
        try {
            const httpResponse = await fetch(`http://${url}`);
            const status = httpResponse.status;

            if (httpResponse.ok || status === 400) {
                return true;
            }

            const r = await httpResponse.text();
            console.log(
                `HTTP ${chalk.red(status)}\n${chalk.red(r.substring(0, 20))}`,
            );

            break;
        } catch (error: any) {
            console.error(
                chalk.red(
                    `Error checking page availability ${url}: ${error?.message}`,
                ),
            );

            // name not found
            if (
                error.cause.code === "ENOTFOUND" ||
                error.cause.code === "UND_ERR_CONNECT_TIMEOUT"
            ) {
                break;
            }

            await new Promise((resolve) => setTimeout(resolve, 500));
        } finally {
            retryCount++;
        }
    } while (retryCount < MAX_RETRIES);

    return false;
}
