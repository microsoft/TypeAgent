// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import puppeteer, { Browser, Page } from "puppeteer";
import { fileURLToPath } from "node:url";
import path from "node:path";

interface ExtensionInfo {
    id: string;
    backgroundPage: Page | null;
}

interface RunnerOptions {
    extensionPath: string;
    targetUrl: string;
    timeout?: number;
}

interface ExtensionRunner {
    browser: Browser | null;
    run(): Promise<void>;
    cleanup(): Promise<void>;
}

class HeadlessExtensionRunner implements ExtensionRunner {
    private options: RunnerOptions;
    browser: Browser | null = null;
    private extensionInfo: ExtensionInfo | null = null;

    constructor(options: RunnerOptions) {
        this.options = {
            timeout: 2000, // Default timeout
            ...options,
        };
    }

    private async initializeBrowser(): Promise<void> {
        this.browser = await puppeteer.launch({
            // headless: false,
            args: [
                `--disable-extensions-except=${this.options.extensionPath}`,
                `--load-extension=${this.options.extensionPath}`,
                "--no-sandbox",
            ],
        });
    }

    private async getExtensionInfo(): Promise<ExtensionInfo> {
        if (!this.browser) {
            throw new Error("Browser not initialized");
        }

        const targets = await this.browser.targets();

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

        const backgroundPageTarget = targets.find(
            (target) =>
                target.type() === "background_page" &&
                target.url().includes(extensionId),
        );

        const backgroundPage = backgroundPageTarget
            ? await backgroundPageTarget.page()
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
            console.log(`Request to: ${request.url()}`);
            request.continue();
        });
    }

    private async sendScriptAction(
        page: Page,
        body: any,
        timeout?: number,
        frameWindow?: Window | undefined,
        idPrefix?: string,
    ) {
        return await page.evaluate((body: any,
            timeout?: number,
            frameWindow?: Window | undefined,
            idPrefix?: string) => {

        const timeoutPromise = new Promise((f) => setTimeout(f, timeout));

        const targetWindow = frameWindow ?? window;

        const actionPromise = new Promise<any | undefined>((resolve) => {
            let callId = new Date().getTime().toString();
            if (idPrefix) {
                callId = idPrefix + "_" + callId;
            }

            targetWindow.postMessage(
                {
                    source: "preload",
                    target: "contentScript",
                    messageType: "scriptActionRequest",
                    id: callId,
                    body: body,
                },
                "*",
            );

            // if timeout is provided, wait for a response - otherwise fire and forget
            if (timeout) {
                const handler = (event: any) => {
                    if (
                        event.data.target == "preload" &&
                        event.data.source == "contentScript" &&
                        event.data.messageType == "scriptActionResponse" &&
                        event.data.id == callId &&
                        event.data.body
                    ) {
                        window.removeEventListener("message", handler);
                        resolve(event.data.body);
                    }
                };

                window.addEventListener("message", handler, false);
            } else {
                resolve(undefined);
            }
        });

        if (timeout) {
            return Promise.race([actionPromise, timeoutPromise]);
        } else {
            return actionPromise;
        }
    }, body,timeout, frameWindow,idPrefix);
    }
/*
    private async sendScriptActionToAllFrames(body: any, timeout?: number) {
        const frames = [window.top, ...Array.from(window.frames)];

        let htmlPromises: Promise<any>[] = [];
        frames.forEach((frame, index) => {
            htmlPromises.push(
                this.sendScriptAction(body, timeout, frame, index.toString()),
            );
        });

        return await Promise.all(htmlPromises);
    }
*/

    public async run(): Promise<void> {
        try {
            await this.initializeBrowser();
            this.extensionInfo = await this.getExtensionInfo();
            console.log(this.extensionInfo); // TODO: Remove

            const screenshotsPath = fileURLToPath(
                new URL(
                    "../dist/",
                    import.meta.url,
                ),
            );


            const page = await this.browser!.newPage();
            await this.setupRequestInterception(page);

            // Navigate to target URL
            await page.goto(this.options.targetUrl, {
                waitUntil: 'networkidle0',
              });


            /*
            await page.waitForNavigation({
                waitUntil: 'networkidle0',
              });
            */

            await page.screenshot({
                path: path.join(screenshotsPath, "justLoaded.png"),
            });

            // Send a message to the page
            await this.sendScriptAction(
                page,
                {
                    type: "scroll_down_on_page",
                },
                500,
            );
        

            await page.screenshot({
                path: path.join(screenshotsPath, "scrolledDown.png"),
            });

            
            await this.sendScriptAction(
                page,
                {
                    type: "scroll_up_on_page",
                },
                500,
            );

            await page.screenshot({
                path: path.join(screenshotsPath, "scrolledUp.png"),
            });
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

// Usage example
async function main() {
    const extensionPath = fileURLToPath(
        new URL(
            path.join("../../../", "./packages/agents/browser/dist/extension"),
            import.meta.url,
        ),
    );

    const runner = new HeadlessExtensionRunner({
        extensionPath: extensionPath,
        targetUrl: "https://homedepot.com",
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

// Run the script
main().catch(console.error);
