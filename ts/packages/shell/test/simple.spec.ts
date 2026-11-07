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
    try {
        const mainWindow: Page = await app.firstWindow();
        await mainWindow.bringToFront();
        expect(fileURLToPath(mainWindow.url())).toContain(getAppPath());
        const row = await app.evaluate(({ app }) => {
            const { createRequire } = process.getBuiltinModule("module");
            const { join } = process.getBuiltinModule("path");
            const shellRequire = createRequire(
                join(app.getAppPath(), "package.json"),
            );
            const serverRequire = createRequire(
                shellRequire.resolve("agent-server"),
            );
            const Database = serverRequire("better-sqlite3");
            const db = new Database(":memory:");
            try {
                return db.prepare("SELECT 1 AS value").get();
            } finally {
                db.close();
            }
        });
        expect(row).toEqual({ value: 1 });
    } finally {
        await app.close();
    }
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
