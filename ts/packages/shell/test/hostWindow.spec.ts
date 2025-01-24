// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test, {
    _electron,
    _electron as electron,
    expect,
    Page,
} from "@playwright/test";
import {
    exitApplication,
    getAppPath,
    getLastAgentMessage,
    sendUserRequest,
    sendUserRequestAndWaitForResponse,
    sendUserRequestFast,
    testSetup,
    waitForAgentMessage,
} from "./testHelper";
import { exit } from "process";

// Annotate entire file as serial.
test.describe.configure({ mode: 'serial' });

test.describe("Shell interface tests", () => {

    /**
     * Test to ensure that the shell recall startup layout (position, size)
     */
    test.skip("remember window position", async () => {
        let agentMessageCount = 0;

        const firstWindow = await testSetup();

        // verify shell title
        const title = await firstWindow.title();
        expect(title.indexOf("🤖") > -1, "Title expecting 🤖 but is missing.");

        // resize the shell by sending @shell settings set size "[width, height]"
        const width: number = Math.ceil(Math.random() * 800 + 200);
        const height: number = Math.ceil(Math.random() * 800 + 200);
        await sendUserRequestAndWaitForResponse(
            `@shell set size "[${width}, ${height}]"`,
            firstWindow,
        );

        // move the window
        const x: number = Math.ceil(Math.random() * 100);
        const y: number = Math.ceil(Math.random() * 100);

        await sendUserRequestAndWaitForResponse(`@shell set position "[${x}, ${y}]"`, firstWindow);

        // close the application
        await exitApplication(firstWindow);

        // restart the app
        const newWindow: Page = await testSetup();

        // get window size/position
        const msg = await sendUserRequestAndWaitForResponse(`@shell show raw`, newWindow);

        // get the shell size and location from the raw settings
        const lines: string[] = msg.split("\n");
        const newWidth: number = parseInt(lines[1].split(":")[1].trim());
        const newHeight: number = parseInt(lines[2].split(":")[1].trim());
        const newX: number = parseInt(lines[4].split(":")[1].trim());
        const newY: number = parseInt(lines[5].split(":")[1].trim());

        expect(newHeight, `Window height mismatch! Expected ${height} got ${height}`).toBe(newHeight);
        expect(newWidth, `Window width mismatch! Expected ${width} got ${width}`).toBe(newWidth);
        expect(newX, `X position mismatch! Expected ${x} got ${newX}`).toBe(x);
        expect(newY, `Y position mismatch!Expected ${y} got ${newY}`).toBe(y);

        // close the application
        await exitApplication(newWindow);
    });

    /**
     * Ensures zoom level is working
     */
    test("zoom level", async () => {
        // start the app
        const mainWindow = await testSetup();

        // test 80% zoom
        await testZoomLevel(0.8, mainWindow);

        // set the zoom level to 120%
        await testZoomLevel(1.2, mainWindow);

        // reset zoomLevel
        await testZoomLevel(1, mainWindow);

        // close the application
        await exitApplication(mainWindow);
    });

    async function testZoomLevel(level: number, page: Page) {

        // set the zoom level to 80%
        await sendUserRequestAndWaitForResponse(`@shell set zoomLevel ${level}`, page);

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
        const mainWindow = await testSetup();

        // make sure send button is disabled
        const sendButton = await mainWindow.locator("#sendbutton");
        await expect(sendButton, "Send button expected to be disabled.").toBeDisabled();

        // put some text in the text box
        const element = await mainWindow.waitForSelector("#phraseDiv");
        await element.fill("This is a test...");

        await expect(sendButton, "Send button expected to be enabled.").toBeEnabled();

        // close the application
        await exitApplication(mainWindow);
    });
});
