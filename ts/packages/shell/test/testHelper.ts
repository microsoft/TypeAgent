// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    _electron as electron,
    ElectronApplication,
    expect,
    Locator,
    Page,
} from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

// These need to be in sync with the UI
const chatViewTitle = "Chat View"; // See chatView.html title tag
const inputDivId = "new_phraseDiv";

const runningApplications: Map<string, ElectronApplication> = new Map<
    string,
    ElectronApplication
>();

/**
 * Starts the electron app and returns the main page after the greeting agent message has been posted.
 */
export async function startShell(): Promise<Page> {
    // this is needed to isolate these tests session from other concurrently running tests
    const instanceName = `test_${process.env["TEST_WORKER_INDEX"]}_${process.env["TEST_PARALLEL_INDEX"]}`;

    process.env["INSTANCE_NAME"] = instanceName;

    // other related multi-instance variables that need to be modified to ensure we can run multiple shell instances
    // Use 3001 as test port and assuming less then 50 port is needed per worker instance
    process.env["PORT"] = (
        3001 +
        parseInt(process.env["TEST_WORKER_INDEX"]!) * 50
    ).toString();
    process.env["WEBSOCKET_HOST"] =
        `ws://localhost:${8080 + parseInt(process.env["TEST_WORKER_INDEX"]!)}`;

    // we may have to retry restarting the application due to session file locks or other such startup failures
    let retryAttempt = 0;
    const maxRetries = 10;

    do {
        try {
            if (runningApplications.has(instanceName)) {
                throw new Error(
                    "Application instance already running. Did you shutdown cleanly?",
                );
            }

            console.log(`Starting electron instance '${instanceName}'`);
            const app: ElectronApplication = await electron.launch({
                args: getLaunchArgs(),
            });
            runningApplications.set(instanceName, app);

            // get the main window
            const mainWindow: Page = await getChatViewWindow(app);

            // wait for agent greeting

            await waitForAgentMessage(mainWindow, 30000, 1, false, ["..."]);

            return mainWindow;
        } catch (e) {
            console.warn(
                `Unable to start electron application (${instanceName}). Attempt ${retryAttempt} of ${maxRetries}. Error: ${e}`,
            );
            retryAttempt++;

            const existing = runningApplications.get(instanceName);
            if (existing) {
                console.log(`Closing instance ${instanceName}`);
                await existing.close();
                runningApplications.delete(instanceName);
            }
        }
    } while (retryAttempt <= maxRetries);

    throw new Error(
        `Failed to start electron app after ${maxRetries} attempts.`,
    );
}

async function getChatViewWindow(app: ElectronApplication): Promise<Page> {
    let attempts = 0;
    do {
        let windows: Page[] = await app.windows();
        // wait for each window to load and return the one we are interested in
        for (const window of windows) {
            try {
                await window.waitForLoadState("domcontentloaded");

                // is this the correct window?
                const title = await window.title();
                if (title === chatViewTitle) {
                    return window;
                }
            } catch (e) {
                console.log(e);
            }
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
    } while (++attempts < 30);

    throw new Error("Unable to find chat view...timeout");
}

/**
 * Cleanly shuts down any running instance of the Shell
 * @param page The main window of the application
 */
export async function exitApplication(page: Page): Promise<void> {
    await sendUserRequestFast("@exit", page);
    const instanceName = process.env["INSTANCE_NAME"]!;
    await runningApplications.get(instanceName)!.close();
    runningApplications.delete(instanceName);
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
    const args = [
        appPath,
        "--test",
        "--env",
        path.resolve(appPath, "../../.env"),
    ];
    if (os.platform() === "linux") {
        // Ubuntu 24.04+ needs --no-sandbox, see https://github.com/electron/electron/issues/18265
        args.push("--no-sandbox");
    }

    return args;
}

export async function getInputElementHandle(page: Page) {
    return page.waitForSelector(`#${inputDivId}`);
}

/**
 * Submits a user request to the system via the chat input box.
 * @param prompt The user request/prompt.
 * @param page The main page from the electron host application.
 */
export async function sendUserRequest(prompt: string, page: Page) {
    const locator: Locator = page.locator(`#${inputDivId}`);
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
    const locator: Locator = page.locator(`#${inputDivId}`);
    await locator.waitFor({ timeout: 5000, state: "visible" });
    await locator.fill(prompt, { timeout: 5000 });
    page.keyboard.down("Enter");
}

/**
 * Submits a user request to the system via the chat input box and then waits for the first available response
 * NOTE: If your expected response changes or you invoke multi-action flow you should be calling
 *   sendUserRequestAndAwaitSpecificResponse() instead of this call
 *
 * Remarks: Use this method when calling @commands...agent calls should use aforementioned function.
 *
 * @param prompt The user request/prompt.
 * @param page The main page from the electron host application.
 */
export async function sendUserRequestAndWaitForResponse(
    prompt: string,
    page: Page,
): Promise<string> {
    const locators: Locator[] = await page
        .locator(".chat-message-agent .chat-message-content")
        .all();

    // send the user request
    await sendUserRequest(prompt, page);

    // wait for agent response
    return waitForAgentMessage(page, 30000, locators.length + 1);
}

/**
 * Submits a user request and awaits for completion of the response.
 *
 * Remarks: Call this function when expecting an agent action response.
 *
 * @param prompt The user request/prompt.
 * @param page The page hosting the user shell
 */
export async function sendUserRequestAndWaitForCompletion(
    prompt: string,
    page: Page,
): Promise<string> {
    const locators: Locator[] = await page
        .locator(".chat-message-agent .chat-message-content")
        .all();

    // send the user request
    await sendUserRequest(prompt, page);

    // wait for agent response
    return waitForAgentMessage(page, 30000, locators.length + 1, true);
}

/**
 * Determines if the supplied agent message/action has been completed
 *
 * @param msg The agent message to check for completion
 */
async function isMessageCompleted(msg: Locator): Promise<boolean> {
    // Agent message is complete once the metrics have been reported
    try {
        const details: Locator = await msg.locator(".metrics-details", {
            hasText: "Total",
        });

        if ((await details.count()) > 0) {
            return true;
        }
    } catch (e) {
        // not found
    }

    return false;
}

async function getAgentMessageFromContainer(locator: Locator): Promise<string> {
    const locators = await locator
        .locator(".chat-message-agent .chat-message-content")
        .all();
    return locators[0].innerText();
}

/**
 *
 * @param page The page where the chatview is hosted
 * @param timeout The maximum amount of time to wait for the agent message
 * @param expectedMessageCount The expected # of agent messages at this time.
 * @param waitForMessageCompletion A flag indicating if we should block util the message is completed.
 * @param ignore A list of messages that this method will consider noise and will reject as false positives
 *          i.e. [".."] and this method will ignore agent messages that are "..." and will continue waiting.
 *          This is useful when an agent sends status messages.
 *
 * @returns the agent message.
 */
async function waitForAgentMessage(
    page: Page,
    timeout: number,
    expectedMessageCount: number,
    waitForMessageCompletion: boolean = false,
    ignore: string[] = [],
): Promise<string> {
    let timeWaited = 0;

    while (true) {
        const locators = await page
            .locator(".chat-message-container-agent")
            .all();
        const messageCount = locators.length;
        if (messageCount >= expectedMessageCount) {
            // Chat view message are in reverse order, so the last one is in index 0
            const lastLocator = locators[0];
            const classNames = await lastLocator.getAttribute("class");
            if (!classNames?.includes("history")) {
                if (
                    !waitForMessageCompletion ||
                    (await isMessageCompleted(lastLocator))
                ) {
                    // If we are waiting for completion, check that first before getting the message content.
                    const lastMessage =
                        await getAgentMessageFromContainer(lastLocator);
                    if (ignore.indexOf(lastMessage) === -1) {
                        return lastMessage;
                    }
                }
            }
        }

        if (timeWaited > timeout) {
            throw new Error("Timeout waiting for agent message");
        }
        await page.waitForTimeout(1000);
        timeWaited += 1000;
    }
}

export async function clearMessages(page: Page): Promise<void> {
    sendUserRequestFast("@clear", page);
    let attempts = 0;
    do {
        attempts++;
        const locators = await page
            .locator(".chat-message-container-agent")
            .all();
        if (locators.length === 0) {
            return;
        }
        await page.waitForTimeout(1000);
    } while (attempts < 30);
    throw new Error("Timeout waiting for clear to complete");
}

/**
 * Deletes test profiles from agent storage
 */
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

export type TestCallback = () => void;

/**
 * Encapsulates the supplied method within a startup and shutdown of teh
 * shell.  Test code executes between them.
 */
export async function runTestCalback(callback: TestCallback): Promise<void> {
    // launch the app
    const mainWindow: Page = await startShell();

    // run the supplied function
    callback();

    // close the application
    await exitApplication(mainWindow);
}

/**
 * Encapsulates the supplied method within a startup and shutdown of teh
 * shell.  Test code executes between them.
 */
export async function testUserRequest(
    userRequests: string[],
    expectedResponses: string[],
): Promise<void> {
    if (userRequests.length != expectedResponses.length) {
        throw new Error("Request/Response count mismatch!");
    }

    // launch the app
    const mainWindow: Page = await startShell();

    // issue the supplied requests and check their responses
    for (let i = 0; i < userRequests.length; i++) {
        const msg = await sendUserRequestAndWaitForCompletion(
            userRequests[i],
            mainWindow,
        );

        // verify expected result
        expect(
            msg,
            `Chat agent didn't respond with the expected message. Request: '${userRequests[i]}', Response: '${expectedResponses[i]}'`,
        ).toBe(expectedResponses[i]);
    }

    // close the application
    await exitApplication(mainWindow);
}
