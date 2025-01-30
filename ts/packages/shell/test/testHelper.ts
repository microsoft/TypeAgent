// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    _electron as electron,
    ElectronApplication,
    Locator,
    Page,
} from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const runningApplications: Map<string, ElectronApplication> = new Map<
    string,
    ElectronApplication
>();

/**
 * Starts the electron app and returns the main page after the greeting agent message has been posted.
 */
export async function startShell(): Promise<Page> {
    // this is needed to isolate these tests session from other concurrently running tests
    process.env["INSTANCE_NAME"] =
        `test_${process.env["TEST_WORKER_INDEX"]}_${process.env["TEST_PARALLEL_INDEX"]}`;

    // other related multi-instance variables that need to be modified to ensure we can run multiple shell instances
    process.env["PORT"] = (
        9001 + parseInt(process.env["TEST_WORKER_INDEX"]!)
    ).toString();
    process.env["WEBSOCKET_HOST"] =
        `ws://localhost:${8080 + parseInt(process.env["TEST_WORKER_INDEX"]!)}`;

    // we may have to retry restarting the application due to session file locks or other such startup failures
    let retryAttempt = 0;
    const maxRetries = 10;

    do {
        try {
            if (runningApplications.has(process.env["INSTANCE_NAME"]!)) {
                throw new Error(
                    "Application instance already running. Did you shutdown cleanly?",
                );
            }

            console.log(
                `Starting electron instance '${process.env["INSTANCE_NAME"]}'`,
            );
            const app: ElectronApplication = await electron.launch({
                args: getLaunchArgs(),
            });
            runningApplications.set(process.env["INSTANCE_NAME"]!, app);

            // get the main window
            const mainWindow: Page = await getMainWindow(app);

            // wait for agent greeting
            await waitForAgentMessage(mainWindow, 30000, 1);

            return mainWindow;
        } catch (e) {
            console.warn(
                `Unable to start electron application (${process.env["INSTANCE_NAME"]}). Attempt ${retryAttempt} of ${maxRetries}. Error: ${e}`,
            );
            retryAttempt++;

            if (runningApplications.get(process.env["INSTANCE_NAME"])) {
                console.log(`Closing instance ${process.env["INSTANCE_NAME"]}`);
                await runningApplications
                    .get(process.env["INSTANCE_NAME"]!)!
                    .close();
            }

            runningApplications.delete(process.env["INSTANCE_NAME"]!);
        }
    } while (retryAttempt <= maxRetries);

    throw new Error(
        `Failed to start electron app after ${maxRetries} attempts.`,
    );
}

async function getMainWindow(app: ElectronApplication): Promise<Page> {
    let attempts = 0;
    do {
        let windows: Page[] = await app.windows();

        // if we change the # of windows beyond 2 we'll have to update this function to correctly disambiguate which window is the correct one
        if (windows.length > 2) {
            console.log(`Found ${app.windows.length} windows.  Expected 2`);
            throw "Please update this logic to select the correct main window. (testHelper.ts->getMainWindow())";
        }

        // wait for each window to load and return the one we are interested in
        for (let i = 0; i < windows.length; i++) {
            try {
                if (windows[i] !== undefined) {
                    await windows[i].waitForLoadState("domcontentloaded");

                    // is this the correct window?
                    const title = await windows[i].title();
                    if (title.length > 0) {
                        console.log(`Found window ${title}`);
                        return windows[i];
                    }
                }
            } catch (e) {
                console.log(e);
            }
        }

        console.log("waiting...");
        await new Promise((resolve) => setTimeout(resolve, 1000));
    } while (++attempts < 30);

    throw "Unable to find window...timeout";
}

/**
 * Cleanly shuts down any running instance of the Shell
 * @param page The main window of the application
 */
export async function exitApplication(page: Page): Promise<void> {
    await sendUserRequestFast("@exit", page);

    await runningApplications.get(process.env["INSTANCE_NAME"]!)!.close();

    runningApplications.delete(process.env["INSTANCE_NAME"]!);
}

/**
 * Gets the shell package path.
 * @returns The root path to the project containing the playwright configuration
 */
export function getAppPath(): string {
    const packagePath = fileURLToPath(new URL("..", import.meta.url));
    const appPath = packagePath.endsWith(path.sep)
        ? packagePath.slice(0, -1)
        : packagePath;

    return appPath;
}

/**
 * Get electron launch arguments
 * @returns The arguments to pass to the electron application
 */
export function getLaunchArgs(): string[] {
    const appPath = getAppPath();
    // Ubuntu 24.04+ needs --no-sandbox, see https://github.com/electron/electron/issues/18265
    return os.platform() === "linux" ? [appPath, "--no-sandbox"] : [appPath];
}

/**
 * Submits a user request to the system via the chat input box.
 * @param prompt The user request/prompt.
 * @param page The main page from the electron host application.
 */
export async function sendUserRequest(prompt: string, page: Page) {
    const locator: Locator = page.locator("#phraseDiv");
    await locator.waitFor({ timeout: 30000, state: "visible" });
    await locator.focus({ timeout: 30000 });
    await locator.fill(prompt, { timeout: 30000 });
    await locator.press("Enter", { timeout: 30000 });
}

/**
 * Submits a user request to the system via the chat input box without waiting.
 * @param prompt The user request/prompt.
 * @param page The main page from the electron host application.
 */
export async function sendUserRequestFast(prompt: string, page: Page) {
    const locator: Locator = page.locator("#phraseDiv");
    await locator.waitFor({ timeout: 120000, state: "visible" });
    await locator.fill(prompt, { timeout: 30000 });
    page.keyboard.down("Enter");
}

/**
 * Submits a user request to the system via the chat input box and then waits for the agent's response
 * @param prompt The user request/prompt.
 * @param page The main page from the electron host application.
 */
export async function sendUserRequestAndWaitForResponse(
    prompt: string,
    page: Page,
): Promise<string> {
    const locators: Locator[] = await page
        .locator(".chat-message-agent-text")
        .all();

    // send the user request
    await sendUserRequest(prompt, page);

    // wait for agent response
    await waitForAgentMessage(page, 30000, locators.length + 1);

    // return the response
    return await getLastAgentMessage(page);
}

/**
 * Gets the last agent message from the chat view
 * @param page The main page from the electron host application.
 */
export async function getLastAgentMessage(page: Page): Promise<string> {
    const locators: Locator[] = await page
        .locator(".chat-message-agent-text")
        .all();

    return locators[0].innerText();
}

/**
 *
 * @param page The page where the chatview is hosted
 * @param timeout The maximum amount of time to wait for the agent message
 * @param expectedMessageCount The expected # of agent messages at this time.
 * @returns When the expected # of messages is reached or the timeout is reached.  Whichever occurs first.
 */
export async function waitForAgentMessage(
    page: Page,
    timeout: number,
    expectedMessageCount?: number | undefined,
): Promise<void> {
    let timeWaited = 0;
    let locators: Locator[] = await page
        .locator(".chat-message-agent-text")
        .all();
    let originalAgentMessageCount = locators.length;
    let messageCount = originalAgentMessageCount;

    if (expectedMessageCount == messageCount) {
        return;
    }

    do {
        await page.waitForTimeout(1000);
        timeWaited += 1000;

        locators = await page.locator(".chat-message-agent-text").all();
        messageCount = locators.length;
    } while (
        timeWaited <= timeout &&
        messageCount == originalAgentMessageCount
    );
}

export function deleteTestProfiles() {
    const profileDir = path.join(os.homedir(), ".typeagent", "profiles");

    if (fs.existsSync(profileDir)) {
        fs.readdirSync(profileDir).map((dirEnt) => {
            if (dirEnt.startsWith("test_")) {
                const dir: string = path.join(profileDir, dirEnt);
                try {
                    fs.rmSync(dir, { recursive: true, force: true });
                } catch (e) {
                    console.warn(`Unable to delete '${dir}', ${e}`);
                }
            }
        });
    }
}
