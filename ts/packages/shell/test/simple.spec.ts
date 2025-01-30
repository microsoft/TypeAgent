// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test, {
    ElectronApplication,
    Page,
    _electron,
    _electron as electron,
    expect,
} from "@playwright/test";
import {
    exitApplication,
    getAppPath,
    sendUserRequestAndWaitForResponse,
    startShell,
} from "./testHelper";

test("dummy", async () => {
    // do nothing
});

test("simple", { tag: "@smoke" }, async ({}, testInfo) => {
    console.log(`Running test '${testInfo.title}`);

    const app: ElectronApplication = await electron.launch({
        args: [getAppPath(), "--no-sandbox"],
    });
    const mainWindow: Page = await app.firstWindow();
    await mainWindow.bringToFront();
    await app.close();
});

test.skip("why is the sky blue?", { tag: "@smoke" }, async ({}, testInfo) => {
    console.log(`Running test '${testInfo.title}`);

    // launch the app
    const mainWindow: Page = await startShell();

    const msg = await sendUserRequestAndWaitForResponse(
        `why is the sky blue?`,
        mainWindow,
    );

    expect(
        msg.toLowerCase(),
        "Chat agent didn't respond with the expected message.",
    ).toContain("raleigh scattering.");

    // close the application
    await exitApplication(mainWindow);
});
