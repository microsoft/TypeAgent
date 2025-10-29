// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test, { expect, Page } from "@playwright/test";
import {
    getInputElementHandle,
    runTestCallback,
    sendUserRequestAndWaitForCompletion,
    sendUserRequestAndWaitForResponse,
} from "./testHelper";

// Annotate entire file as serial.
test.describe.configure({ mode: "serial" });

test.describe("Shell interface tests", () => {
    /**
     * Test to ensure that the shell recall startup layout (position, size)
     */
    // robgruen - 09.11.2025 - temporarily skipping while we redo UI layout to support different modes
    test("remember window position", async ({}, testInfo) => {
        console.log(`Running test '${testInfo.title}'`);
        const x: number = Math.ceil(Math.random() * 100);
        const y: number = Math.ceil(Math.random() * 100);
        const width: number = Math.ceil(Math.random() * 800 + 200);
        const height: number = Math.ceil(Math.random() * 800 + 200);
        await runTestCallback(async (firstWindow: Page) => {
            // verify shell title
            const title = await firstWindow.title();
            //expect("Active TypeAgent", "Invalid page title!");
            expect(
                title.indexOf("🤖") > -1,
                "Title expecting 🤖 but is missing.",
            );

            // move & resize the shell by sending @shell settings setWindowState  "x y width height"

            await sendUserRequestAndWaitForResponse(
                `@shell setWindowState ${x} ${y} ${width} ${height}`,
                firstWindow,
            );
        });

        // restart the app
        await runTestCallback(async (newWindow: Page) => {
            // get window size/position
            const msg = await sendUserRequestAndWaitForResponse(
                `@shell show window`,
                newWindow,
            );

            // get the shell size and location from the raw settings
            const lines: string[] = msg.split("\n");
            const newWidth: number = parseInt(lines[2].split(":")[1].trim());
            const newHeight: number = parseInt(lines[3].split(":")[1].trim());
            const newX: number = parseInt(lines[0].split(":")[1].trim());
            const newY: number = parseInt(lines[1].split(":")[1].trim());

            expect(
                newHeight,
                `Window height mismatch! Expected ${height} got ${newHeight}`,
            ).toBe(newHeight);
            expect(
                newWidth,
                `Window width mismatch! Expected ${width} got ${newWidth}`,
            ).toBe(newWidth);
            expect(newX, `X position mismatch! Expected ${x} got ${newX}`).toBe(
                x,
            );
            expect(newY, `Y position mismatch!Expected ${y} got ${newY}`).toBe(
                y,
            );
        });
    });

    /**
     * Ensures zoom level is working
     */
    test("zoom level", async ({}, testInfo) => {
        console.log(`Running test '${testInfo.title}'`);

        // start the app
        await runTestCallback(async (mainWindow: Page) => {
            // test 80% zoom
            await testZoomLevel(80, mainWindow);

            // set the zoom level to 120%
            await testZoomLevel(120, mainWindow);

            // reset zoomLevel
            await testZoomLevel(100, mainWindow);
        });
    });

    async function testZoomLevel(level: number, page: Page) {
        // set the zoom level to 80%
        await sendUserRequestAndWaitForResponse(
            `@shell setWindowZoomLevel ${level}`,
            page,
        );

        // get the title
        let title = await page.title();

        // get zoom level out of title
        let subTitle: string | undefined = title.match(/\d+%/)
            ? title.match(/\d+%/)![0]
            : undefined;
        if (subTitle === undefined) {
            expect(
                subTitle,
                `Unexpected zoomLevel, expected ${level}, got '${subTitle}'`,
            ).toBe(undefined);
        } else {
            let zoomLevel: number = parseInt(
                subTitle.substring(0, subTitle.length - 1),
            );
            expect(
                zoomLevel,
                `Unexpected zoomLevel, expected ${level}, got ${zoomLevel}`,
            ).toBeCloseTo(level, 0);
        }
    }

    /**
     * Ensure send button is behaving
     */
    test("send button state", async ({}, testInfo) => {
        console.log(`Running test '${testInfo.title}'`);

        // start the app
        await runTestCallback(async (mainWindow: Page) => {
            // make sure send button is disabled
            const sendButton = await mainWindow.locator("#sendbutton");
            await expect(
                sendButton,
                "Send button expected to be disabled.",
            ).toBeDisabled();

            // put some text in the text box
            const element = await getInputElementHandle(mainWindow);
            await element.fill("This is a test...");
            await element.press("Space");

            await expect(
                sendButton,
                "Send button expected to be enabled.",
            ).toBeEnabled();
        });
    });

    test("command backstack", async ({}, testInfo) => {
        console.log(`Running test '${testInfo.title}'`);

        // start the app
        await runTestCallback(async (mainWindow: Page) => {
            // issue some commands
            const commands: string[] = ["@history", "@help", "@config agent"];
            for (let i = 0; i < commands.length; i++) {
                await sendUserRequestAndWaitForCompletion(
                    commands[i],
                    mainWindow,
                );
            }

            // get the input box
            const element = await getInputElementHandle(mainWindow);

            // go through the command back stack to the end and make sure we get the expected
            // results. (command and cursor location)
            for (let i = commands.length - 1; i >= -1; i--) {
                // press the up arrow
                await element.press("ArrowUp");

                // make sure that the text box now has the proper command
                const text = await element.innerText();

                // when we get to the end and hit up again it should still have the last command
                let cmd = commands[i];
                if (i < 0) {
                    cmd = commands[0];
                }

                expect(text, "Wrong back stack command found!").toBe(cmd);
            }

            // now reverse the process
            for (let i = 1; i <= commands.length; i++) {
                // press the up arrow
                await element.press("ArrowDown");

                // make sure that the text box now has the proper command
                const text = await element.innerText();

                // when we get to the end and hit up again it should still have the last command
                let cmd = commands[i];
                if (i == commands.length) {
                    cmd = "";
                }

                expect(text, "Wrong back stack command found!").toBe(cmd);
            }
        });
    });
});
