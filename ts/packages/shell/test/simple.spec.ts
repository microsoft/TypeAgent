// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test, {
    ElectronApplication,
    Page,
    _electron as electron,
    expect,
} from "@playwright/test";
import {
    getAppPath,
    sendUserRequestAndWaitForCompletion,
    getLaunchArgs,
    runTestCallback,
} from "./testHelper";
import { fileURLToPath } from "node:url";

test("simple", { tag: "@smoke" }, async ({}, testInfo) => {
    const app: ElectronApplication = await electron.launch({
        args: getLaunchArgs(true),
    });
    const mainWindow: Page = await app.firstWindow();
    await mainWindow.bringToFront();
    expect(fileURLToPath(mainWindow.url())).toContain(getAppPath());
    await app.close();
});

test("startShell", { tag: "@smoke" }, async ({}) => {
    await runTestCallback(async () => {}, true);
});

test("why is the sky blue?", { tag: "@smoke" }, async ({}, testInfo) => {
    console.log(`Running test '${testInfo.title}'`);

    // launch the app
    await runTestCallback(async (mainWindow: Page) => {
        const msg = await sendUserRequestAndWaitForCompletion(
            `why is the sky blue?`,
            mainWindow,
        );

        expect(
            msg.toLowerCase(),
            "Chat agent didn't respond with the expected message.",
        ).toContain("scatter");
    }, true);
});
