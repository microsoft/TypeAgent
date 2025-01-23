// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test, { _electron, Browser, _electron as electron, expect, ViewportSize } from "@playwright/test";
import { getAppPath, getLastAgentMessage, sendUserRequest, waitForAgentMessage } from "./testHelper";
import { BrowserWindow, BrowserWindow as bw } from "electron";


/**
 * Test to ensure that the shell recall startup layout (position, size)
 */
test("remember window position", async () => {
    const electronApp = await electron.launch({ args: [getAppPath()] });

    electronApp.on('window', data => {
        console.log(data);
    });

    // get the main window
    const firstWindow = await electronApp.firstWindow();

    // get the browser window handle for said window
    const browser = await electronApp.browserWindow(firstWindow);

    // verify shell title
    const title = await firstWindow.title();
    expect(title.indexOf("🤖") > -1, "Title expecting 🤖 but is missing.");

    // wait for agent greeting
    await waitForAgentMessage(firstWindow, 10000, 1);

    // resize the shell by sending @shell settings set size "[width, height]"
    const width: number = Math.ceil(Math.random() * 800 + 200);
    const height: number =  Math.ceil(Math.random() * 800 + 200);
    await sendUserRequest(`@shell set size "[${width}, ${height}]"`, firstWindow);

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
    const newWindow = await newElectronApp.firstWindow();
    const newBrowser = await newElectronApp.browserWindow(newWindow);

    // wait for agent greeting
    await waitForAgentMessage(newWindow, 10000, 1);

    // get window size/position
    await sendUserRequest(`@shell show raw`, newWindow);

    // wait for agent response
    await waitForAgentMessage(newWindow, 10000, 2);

    // get the shell size and location from the raw settings
    const msg =await getLastAgentMessage(newWindow);
    const lines: string[] = msg.split("\n");
    const newWidth: number = parseInt(lines[1].split(":")[1].trim());
    const newHeight: number = parseInt(lines[2].split(":")[1].trim());
    const newX: number = parseInt(lines[4].split(":")[1].trim());
    const newY: number = parseInt(lines[5].split(":")[1].trim());
    
    expect(newHeight == height, "Window height mismatch!");
    expect(newWidth == width, "Window width mismatch!");
    expect(newX == x, "X position mismatch!");
    expect(newY == y, "Y position mismatch!");
});