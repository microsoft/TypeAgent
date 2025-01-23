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

/**
 * Test to ensure that the shell recall startup layout (position, size)
 */
test("remember window position", async () => {
    // start the app
    const electronApp = await electron.launch({ args: [getAppPath()] });

    // get the main window
    const firstWindow: Page = await electronApp.firstWindow();

    // wait for agent greeting
    await waitForAgentMessage(firstWindow, 10000, 1);

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
    await waitForAgentMessage(firstWindow, 10000, 2);

    // move the window
    const x: number = Math.ceil(Math.random() * 100);
    const y: number = Math.ceil(Math.random() * 100);

    await sendUserRequest(`@shell set position "[${x}, ${y}]"`, firstWindow);

    // wait for agent response
    await waitForAgentMessage(firstWindow, 10000, 3);

    // close the application
    await electronApp.close();

    // restart the app
    const newElectronApp = await electron.launch({ args: [getAppPath()] });
    const newWindow: Page = await newElectronApp.firstWindow();

    // wait for agent greeting
    await waitForAgentMessage(newWindow, 10000, 1);

    // get window size/position
    await sendUserRequest(`@shell show raw`, newWindow);

    // wait for agent response
    await waitForAgentMessage(newWindow, 10000, 2);

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
    // start the app
    const electronApp = await electron.launch({ args: [getAppPath()] });

    // get the main window
    const mainWindow = await electronApp.firstWindow();

    // wait for agent greeting
    await waitForAgentMessage(mainWindow, 10000, 1);

    // get the title
    let title = await mainWindow.title();

    // get zoom level out of title
    let subTitle: string = title.match(/\d+%/)![0];
    const origZoomLevel: number = parseInt(subTitle.substring(0, subTitle.length - 1));

    // // Focus on the body
    // await mainWindow.focus('body');

    const e = await mainWindow.waitForSelector(".chat-container");
await e.focus();
    // // zoom in
    // // await mainWindow.press('body', "CTRL+Plus");
    // await mainWindow.keyboard.down('Control');
    // //await mainWindow.keyboard.press('+');
    // await mainWindow.mouse.wheel(0, 5);
    // await mainWindow.keyboard.up('Control');
    // await mainWindow.keyboard.press("Control+-");
    
    // // for title update
    // await mainWindow.waitForTimeout(1000);
    // //await main
    // //await mainWindow.press('@document', "Control++");
    await e.press("Control+-");

    // get the title
    title = await mainWindow.title(); 

    // get zoom level out of title
    subTitle = title.match(/\d+%/)![0];
    const newZoomLevel: number = parseInt(subTitle.substring(0, subTitle.length - 1));
    
    expect(newZoomLevel, `Zoom not functioning as expected. Expected ${origZoomLevel}% got ${newZoomLevel}%`).toBeGreaterThan(origZoomLevel);

    // close the application
    await electronApp.close();
});
