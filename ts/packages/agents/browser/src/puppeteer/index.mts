// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Browser, Page } from "puppeteer";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
// import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';

import { fileURLToPath } from "node:url";
import fs from "fs";
import path from "node:path";
import readline from "readline/promises";
import os from "node:os";

export interface ExtensionInfo {
    id: string;
    backgroundPage: Page | null;
}

interface RunnerOptions {
    extensionPath: string;
    isVisible: boolean;
    timeout?: number;
    useChrome: boolean;
}

interface ExtensionRunner {
    browser: Browser | null;
    run(): Promise<void>;
    cleanup(): Promise<void>;
}

export class HeadlessExtensionRunner implements ExtensionRunner {
    private options: RunnerOptions;
    browser: Browser | null = null;

    constructor(options: RunnerOptions) {
        this.options = {
            timeout: 2000, // Default timeout
            ...options,
        };

        puppeteer.use(StealthPlugin());
        // puppeteer.use(AdblockerPlugin({ blockTrackers: true }))
    }

    private async initializeBrowser(): Promise<void> {
        let userDataDir = this.getChromeProfilePath();
        if (!fs.existsSync(userDataDir)) {
            userDataDir = path.join(os.homedir(), "puppeteer_user_data");
        }

        if (this.options.useChrome) {
            this.closeChrome();

            this.browser = await puppeteer.launch({
                executablePath: this.getChromeExecutablePath(),
                userDataDir: this.getChromeProfilePath(),
                headless: !this.options.isVisible,
                args: [
                    `--disable-extensions-except=${this.options.extensionPath}`,
                    `--load-extension=${this.options.extensionPath}`,
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                ],
            });
        } else {
            this.browser = await puppeteer.launch({
                headless: !this.options.isVisible,
                userDataDir: userDataDir,
                args: [
                    `--disable-extensions-except=${this.options.extensionPath}`,
                    `--load-extension=${this.options.extensionPath}`,
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                ],
            });
        }
    }

    private getChromeProfilePath(): string {
        const platform = process.platform;

        if (platform === "win32") {
            return path.join(
                os.homedir(),
                "AppData",
                "Local",
                "Google",
                "Chrome",
                "User Data",
            );
        } else if (platform === "darwin") {
            return path.join(
                os.homedir(),
                "Library",
                "Application Support",
                "Google",
                "Chrome",
            );
        } else if (platform === "linux") {
            return path.join(os.homedir(), ".config", "google-chrome");
        } else {
            throw new Error("Unsupported OS");
        }
    }

    private async closeChrome() {
        const { exec } = await import("child_process");

        return new Promise<void>((resolve, reject) => {
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

            exec(command, async (error, stdout, stderr) => {
                if (error) {
                    console.log(
                        `Chrome may not be running or couldn't be closed: ${error.message}`,
                    );
                    // Don't reject since this is not critical
                    resolve();
                    return;
                }

                if (stderr) {
                    console.log(`Chrome close error output: ${stderr}`);
                }

                console.log(`Chrome closed successfully: ${stdout}`);
                resolve();
            });
        });
    }

    private getChromeExecutablePath(): string {
        const platform = process.platform;
        let chromePath: string | null = null;

        if (platform === "win32") {
            chromePath = path.join(
                "C:",
                "Program Files (x86)",
                "Google",
                "Chrome",
                "Application",
                "chrome.exe",
            );
            if (!fs.existsSync(chromePath)) {
                chromePath = path.join(
                    "C:",
                    "Program Files",
                    "Google",
                    "Chrome",
                    "Application",
                    "chrome.exe",
                );
            }
        } else if (platform === "darwin") {
            chromePath =
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
        } else if (platform === "linux") {
            chromePath = "/usr/bin/google-chrome";
            if (!fs.existsSync(chromePath)) {
                chromePath = "/usr/bin/chromium-browser";
            }
        } else {
            throw new Error("Unsupported OS");
        }

        if (chromePath && fs.existsSync(chromePath)) {
            return chromePath;
        } else {
            throw new Error("Chrome executable not found");
        }
    }

    private async getServiceWorker(): Promise<ExtensionInfo> {
        if (!this.browser) {
            throw new Error("Browser not initialized");
        }

        const serviceWorkerTarget = await this.browser.waitForTarget(
            (target) =>
                target.type() === "service_worker" &&
                target.url().includes("chrome-extension://"),
        );

        if (!serviceWorkerTarget) {
            throw new Error("Extension service worker not found");
        }

        const extensionUrl = serviceWorkerTarget.url();
        const extensionId = extensionUrl.split("/")[2];

        const backgroundPage = serviceWorkerTarget
            ? await serviceWorkerTarget.page()
            : null;

        return {
            id: extensionId,
            backgroundPage,
        };
    }

    private async setupRequestInterception(page: Page): Promise<void> {
        await page.setRequestInterception(true);

        page.on("request", (request) => {
            // Log or modify requests here
            request.continue();
        });
    }

    public async run(): Promise<void> {
        try {
            await this.initializeBrowser();
            await this.getServiceWorker();

            const page = await this.browser!.newPage();
            await this.setupRequestInterception(page);

            process.send?.("Success");

            const stdio = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
            });
            while (true) {
                const input = await stdio.question("");
                if (
                    input.toLowerCase() === "quit" ||
                    input.toLowerCase() === "exit"
                ) {
                    break;
                } else if (input.length) {
                    console.log(input);
                }
            }
            stdio.close();
        } catch (error) {
            console.error("Error running extension:", error);
            throw error;
        }
    }

    public async cleanup(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }
}

export async function main() {
    const extensionPath = fileURLToPath(
        new URL(path.join("..", "./extension"), import.meta.url),
    );

    const consoleArgs = process.argv.slice(2);

    const runner = new HeadlessExtensionRunner({
        extensionPath: extensionPath,
        isVisible: JSON.parse(consoleArgs[0]),
        timeout: 2000,
        useChrome: JSON.parse(consoleArgs[1]),
    });

    try {
        await runner.run();
    } catch (error) {
        console.error("Failed to run extension:", error);
    } finally {
        await runner.cleanup();
    }
}

process.on("disconnect", () => {
    process.exit(1);
});

// Run the script
main().catch(console.error);
