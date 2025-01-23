// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test, {
    _electron,
    Browser,
    _electron as electron,
    expect,
    Page,
    ViewportSize,
} from "@playwright/test";
import {
    getAppPath,
    getLastAgentMessage,
    sendUserRequest,
    waitForAgentMessage,
} from "./testHelper";
import { send } from "node:process";

/**
 * Test to ensure that the shell recall startup layout (position, size)
 */
test("remember window position", async () => {
    let agentMessageCount = 0;

    // start the app
    const electronApp = await electron.launch({ args: [getAppPath()] });

    // get the main window
    const firstWindow: Page = await electronApp.firstWindow();

    // wait for agent greeting
    await waitForAgentMessage(firstWindow, 10000, ++agentMessageCount);

    // verify shell title
    const title = await firstWindow.title();
    expect(title.indexOf("🤖") > -1, "Title expecting 🤖 but is missing.");

    // resize the shell by sending @shell settings set size "[width, height]"
    const width: number = Math.ceil(Math.random() * 800 + 200);
    const height: number = Math.ceil(Math.random() * 800 + 200);
    await sendUserRequest(
        `@shell set size "[${width}, ${height}]"`,
        firstWindow,
    );

    // wait for agent response
    await waitForAgentMessage(firstWindow, 10000, ++agentMessageCount);

    // move the window
    const x: number = Math.ceil(Math.random() * 100);
    const y: number = Math.ceil(Math.random() * 100);

    await sendUserRequest(`@shell set position "[${x}, ${y}]"`, firstWindow);

    // wait for agent response
    await waitForAgentMessage(firstWindow, 10000, ++agentMessageCount);

    // close the application
    await electronApp.close();

    // restart the app
    const newElectronApp = await electron.launch({ args: [getAppPath()] });
    const newWindow: Page = await newElectronApp.firstWindow();

    // wait for agent greeting
    agentMessageCount = 0;
    await waitForAgentMessage(newWindow, 10000, ++agentMessageCount);

    // get window size/position
    await sendUserRequest(`@shell show raw`, newWindow);

    // wait for agent response
    await waitForAgentMessage(newWindow, 10000, ++agentMessageCount);

    // get the shell size and location from the raw settings
    const msg = await getLastAgentMessage(newWindow);
    const lines: string[] = msg.split("\n");
    const newWidth: number = parseInt(lines[1].split(":")[1].trim());
    const newHeight: number = parseInt(lines[2].split(":")[1].trim());
    const newX: number = parseInt(lines[4].split(":")[1].trim());
    const newY: number = parseInt(lines[5].split(":")[1].trim());

    expect(newHeight, `Window height mismatch! Expected ${height} got ${height}`).toBe(newHeight);
    expect(newWidth, `Window width mismatch! Expected ${width} got ${width}`).toBe(newWidth);
    expect(newX, `X position mismatch! Expected ${x} got ${newX}`).toBe(x);
    expect(newY, `Y position mismatch!Expected ${y} got ${newY}`).toBe(y);
});

/**
 * Ensures zoom level is working
 */
test("zoom level", async () => {

    let agentMessageCount = 0;

    // start the app
    const electronApp = await electron.launch({ args: [getAppPath()] });

    // get the main window
    const mainWindow = await electronApp.firstWindow();

    // wait for agent greeting
    await waitForAgentMessage(mainWindow, 10000, ++agentMessageCount);

    // test 80% zoom
    await testZoomLevel(0.8, mainWindow, agentMessageCount++);

    // set the zoom level to 120%
    await testZoomLevel(1.2, mainWindow, agentMessageCount++);

    // reset zoomLevel
    await testZoomLevel(1, mainWindow, agentMessageCount++);

    // close the application
    await electronApp.close();
});

async function testZoomLevel(level: number, page: Page, agentMessageCount: number) {

    // set the zoom level to 80%
    await sendUserRequest(`@shell set zoomLevel ${level}`, page);

    // wait for agent response
    await waitForAgentMessage(page, 10000, ++agentMessageCount);

    // get the title
    let title = await page.title();

    // get zoom level out of title
    let subTitle: string = title.match(/\d+%/)![0];
    let zoomLevel: number = parseInt(subTitle.substring(0, subTitle.length - 1));

    expect(zoomLevel, `Unexpected zoomLevel, expected ${level * 100}, got ${zoomLevel}`).toBe(level * 100);    
}

/**
 * Ensure send button is behaving
 */
test("send button state", async () => {
    let agentMessageCount = 0;

    // start the app
    const electronApp = await electron.launch({ args: [getAppPath()] });

    // get the main window
    const mainWindow = await electronApp.firstWindow();

    // // wait for agent greeting
    // await waitForAgentMessage(mainWindow, 10000, ++agentMessageCount);

    // make sure send button is disabled
    const sendButton = await mainWindow.locator("#sendbutton");
    await expect(sendButton, "Send button expected to be disabled.").toBeDisabled();

    // put some text in the text box
    const element = await mainWindow.waitForSelector("#phraseDiv");
    await element.fill("This is a test...");

    await expect(sendButton, "Send button expected to be enabled.").toBeEnabled();

    // close the application
    await electronApp.close();
});
