// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test, { _electron, Browser, _electron as electron, expect, ViewportSize } from "@playwright/test";
import { getAppPath } from "./testHelper";
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

    // resize the shell
    const size: ViewportSize = { width: Math.ceil(Math.random() * 800 + 200), height: Math.ceil(Math.random() * 800 + 200) };
    // //await window.setViewportSize(size);
    // await firstWindow.setViewportSize(size);
    await firstWindow.evaluate(`
        // const { BrowserWindow } = require('electron');        
        // BrowserWindow.getAllWindows().map((bw) => {
        //     bw.setBounds({ width: size.width, height: size.height });
        // });
        window.width = 100;
    `);    

    // const width = await browser.evaluate((w) => 
    //     { 
    //         eval("window.width = Math.ceil(Math.random() * 800 + 200);")
    //         return eval("window.width");
    //     });
    // const height = await browser.evaluate((w) => 
    //     { 
    //         eval("window").height = Math.ceil(Math.random() * 800 + 200);
    //         return w.height; 
    //     });
    
    // move the shell somewhere
    const x: number = await browser.evaluate((w) => {
        w.screenX = Math.ceil(Math.random() * 100);
        return w.screenX;
    });
    const y: number = await browser.evaluate((w) => {
        w.screenY = Math.ceil(Math.random() * 100);
        return w.screenY;
    });

    // close the application
    await electronApp.close();

    // restart the app
    const newElectronApp = await electron.launch({ args: [getAppPath()] });
    const newWindow = await newElectronApp.firstWindow();
    const newBrowser = await newElectronApp.browserWindow(newWindow);

    // get the shell size and location
    const newSize: ViewportSize = newWindow.viewportSize()!;
    const newX: number = await newBrowser.evaluate((w) => { return w.screenX; });
    const newY: number = await newBrowser.evaluate((w) => { return w.screenY; });
    
    expect(newSize.height == size.height, "Window height mismatch!");
    expect(newSize.width == size.width, "Window width mismatch!");
    expect(newX == x, "X position mismatch!");
    expect(newY == y, "Y position mismatch!");
});