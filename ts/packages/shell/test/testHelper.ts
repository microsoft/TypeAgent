// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {     
    _electron,
    _electron as electron,
    ElectronApplication, 
    Locator, 
    Page, 
    TestDetails} from "@playwright/test";
import { profile } from "node:console";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const runningApplications: Map<string, ElectronApplication> = new Map<string, ElectronApplication>();

/**
 * Starts the electron app and returns the main page after the greeting agent message has been posted.
 */
export async function startShell(): Promise<Page> {

    // this is needed to isolate these tests session from other concurrently running tests
    process.env["INSTANCE_NAME"] = `test_${process.env["TEST_WORKER_INDEX"]}_${process.env["TEST_PARALLEL_INDEX"]}`;

    // other related multi-instance varibles that need to be modfied to ensure we can run multiple shell instances
    process.env["PORT"] = (9001 + parseInt(process.env["TEST_WORKER_INDEX"]!)).toString();
    process.env["WEBSOCKET_HOST"] = `ws://localhost:${(8080 + parseInt(process.env["TEST_WORKER_INDEX"]!))}`;

    // we may have to retry restarting the application due to session file locks or other such startup failures
    let retryAttempt = 0;
    const maxRetries = 10;

    do {
        try {            
            if (runningApplications.has(process.env["INSTANCE_NAME"]!)) {
                throw new Error("Application instance already running. Did you shutdown cleanly?");
            }

            console.log(`Starting electron instance '${process.env["INSTANCE_NAME"]}'`);
            const app: ElectronApplication = await electron.launch({ args: [getAppPath()] });
            runningApplications.set(process.env["INSTANCE_NAME"]!, app);

            // app.on('window', async (data) => {
            //     console.log(`New Window created! ${await data.content()}`);
            // });

            // get the main window        
            const mainWindow: Page = await getMainWindow(app);

            // wait for agent greeting
            await waitForAgentMessage(mainWindow, 30000, 1);

            return mainWindow;

        } catch (e) {            
            console.warn(`Unable to start electrom application (${process.env["INSTANCE_NAME"]}). Attempt ${retryAttempt} of ${maxRetries}`);            
            retryAttempt++;

            if (runningApplications.get(process.env["INSTANCE_NAME"])) {
                await runningApplications.get(process.env["INSTANCE_NAME"]!)!.close();
            }

            runningApplications.delete(process.env["INSTANCE_NAME"]!);
        }
    } while (retryAttempt <= maxRetries);

    throw new Error(`Failed to start electrom app after ${maxRetries} attemps.`);
}

async function getMainWindow(app: ElectronApplication): Promise<Page> {
    const window: Page = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    // is this the correct window?
    if ((await window.title()).length > 0) {
        return window;
    }

    // if we change the # of windows beyond 2 we'll have to update this function to correctly disambiguate which window is the correct one
    if (app.windows.length > 2) {
        throw "Please update this logic to select the correct main window. (testHelper.ts->getMainWindow())";
    }

    // since there are only two windows we know that if the first one isn't the right one we can just return the second one
    return app.windows[app.windows.length - 1];
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
 * Gets the correct path based on test context (cmdline vs. VSCode extension)
 * @returns The root path to the project containing the playwright configuration
 */
export function getAppPath(): string {
    if (fs.existsSync("playwright.config.ts")) {
        return ".";
    } else {
        return path.join(".", "packages/shell");
    }
}

/**
 * Submits a user request to the system via the chat input box.
 * @param prompt The user request/prompt.
 * @param page The maing page from the electron host application.
 */
export async function sendUserRequest(prompt: string, page: Page) {

    try {
        const locator: Locator = page.locator("#phraseDiv");
        //const locator: Locator = await page.locator(".user-textarea");
        await locator.waitFor({ timeout: 30000, state: "visible" });
        await locator.focus({ timeout: 30000 });
        await locator.fill(prompt, { timeout: 30000 });
        await locator.press("Enter", { timeout: 30000 });

        return;
    } catch (e) {
        // // TODO: find alternate method when the above fails.
        // console.log(e);    

        // let title = await page.title();
        // console.log(title);

        // const c = await page.content();
        // console.log(c);
    }
}

/**
 * Submits a user request to the system via the chat input box without waiting.
 * @param prompt The user request/prompt.
 * @param page The maing page from the electron host application.
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
 * @param page The maing page from the electron host application.
 */
export async function sendUserRequestAndWaitForResponse(prompt: string, page: Page): Promise<string> {
    const locators: Locator[] = await page.locator('.chat-message-agent-text').all();

    // send the user request
    await sendUserRequest(prompt, page);

    // wait for agent response
    await waitForAgentMessage(page, 30000, locators.length + 1);

    // return the response
    return await getLastAgentMessage(page);
}

/**
 * Gets the last agent message from the chat view
 * @param page The maing page from the electron host application.
 */
export async function getLastAgentMessage(page: Page): Promise<string> {
    const locators: Locator[] = await page.locator('.chat-message-agent-text').all();

    return locators[0].innerText();
}

/**
 * 
 * @param page The page where the chatview is hosted
 * @param timeout The maximum amount of time to wait for the agent message
 * @param expectedMessageCount The expected # of agent messages at this time.
 * @returns When the expected # of messages is reached or the timeout is reached.  Whichever occurrs first.
 */
export async function waitForAgentMessage(page: Page, timeout: number, expectedMessageCount?: number | undefined): Promise<void> {
    let timeWaited = 0;
    let locators: Locator[] = await page.locator('.chat-message-agent-text').all();
    let originalAgentMessageCount = locators.length;
    let messageCount = originalAgentMessageCount;

    if (expectedMessageCount == messageCount) {
        return;
    }

    do {
        await page.waitForTimeout(1000);
        timeWaited += 1000;
        
        locators = await page.locator('.chat-message-agent-text').all();
        messageCount = locators.length;

    } while (timeWaited <= timeout && messageCount == originalAgentMessageCount);
}

export function deleteTestProfiles() {
    const profileDir = path.join(os.homedir(), ".typeagent", "profiles");

    if (fs.existsSync(profileDir)) {
        fs.readdirSync(profileDir).map((dirEnt) =>{
            if (dirEnt.startsWith("test_")) {
                const dir: string = path.join(profileDir, dirEnt)
                try {
                    fs.rmSync(dir, { recursive: true, force: true });
                } catch (e) {
                    console.warn(`Unable to delete '${dir}', ${e}`);
                }
            }
        });
    }
}
