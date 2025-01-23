// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {     
    _electron,
    _electron as electron,
    ElectronApplication, 
    Locator, 
    Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

let runningApplication: ElectronApplication | null = null;

/**
 * Starts the electron app and returns the main page after the greeting agent message has been posted.
 */
export async function testSetup(): Promise<Page> {
    // agent message count
    let agentMessageCount = 0;

    // start the app
    if (runningApplication !== null) {
        throw new Error("Application instance already running. Did you shutdown cleanly?");
    }

    runningApplication = await electron.launch({ args: [getAppPath()] });

    // get the main window
    const mainWindow: Page = await runningApplication.firstWindow();

    // wait for agent greeting
    await waitForAgentMessage(mainWindow, 10000, ++agentMessageCount);

    return mainWindow;
}

/**
 * Cleanly shuts down any running instance of the Shell
 * @param page The main window of the application
 */
export async function exitApplication(page: Page): Promise<void> {
    await sendUserRequestFast("@exit", page);

    await runningApplication!.close();
    runningApplication = null;
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
    const element = await page.waitForSelector("#phraseDiv");
    await element.focus();
    await element.fill(prompt);
    await element.press("Enter");
}

/**
 * Submits a user request to the system via the chat input box without waiting.
 * @param prompt The user request/prompt.
 * @param page The maing page from the electron host application.
 */
export async function sendUserRequestFast(prompt: string, page: Page) {    
    const element = await page.waitForSelector("#phraseDiv");
    await element.fill(prompt);
    page.keyboard.down("Enter");
}

/**
 * Submits a user request to the system via the chat input box and then waits for the agent's response
 * @param prompt The user request/prompt.
 * @param page The maing page from the electron host application.
 */
export async function sendUserRequestAndWaitForResponse(prompt: string, page: Page) {
    const locators: Locator[] = await page.locator('.chat-message-agent-text').all();

    // send the user request
    await sendUserRequest(prompt, page);

    // wait for agent response
    await waitForAgentMessage(page, 10000, locators.length + 1);
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
