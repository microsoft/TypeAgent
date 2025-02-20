// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Browser, Page } from "puppeteer";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
// import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';

import { fileURLToPath } from "node:url";
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
        const userDataDir = path.join(os.homedir(), "puppeteer_user_data");

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
