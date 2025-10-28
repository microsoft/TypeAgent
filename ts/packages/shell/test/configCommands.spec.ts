// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test, { expect, Page } from "@playwright/test";
import {
    runTestCallback,
    sendUserRequestAndWaitForResponse,
} from "./testHelper";

// Annotate entire file as serial.
test.describe.configure({ mode: "serial" });

test.describe("@config Commands", () => {
    test("@config dev", async ({}, testInfo) => {
        console.log(`Running test '${testInfo.title}'`);

        await runTestCallback(async (mainWindow: Page) => {
            let msg = await sendUserRequestAndWaitForResponse(
                `@config dev`,
                mainWindow,
            );

            expect(
                msg.toLowerCase(),
                "Dev mode was not turned on as expected.",
            ).toBe("development mode is enabled.");

            msg = await sendUserRequestAndWaitForResponse(
                `@config dev on`,
                mainWindow,
            );

            expect(
                msg.toLowerCase(),
                "Dev mode was not turned on as expected.",
            ).toBe("development mode is enabled.");

            msg = await sendUserRequestAndWaitForResponse(
                `@config dev off`,
                mainWindow,
            );

            expect(
                msg.toLowerCase(),
                "Dev mode was not turned off as expected.",
            ).toBe("development mode is disabled.");
        });
    });

    test("@config schema", async ({}, testInfo) => {
        console.log(`Running test '${testInfo.title}'`);

        await runTestCallback(async (mainWindow: Page) => {
            let msg = await sendUserRequestAndWaitForResponse(
                `@config schema oracle`,
                mainWindow,
            );

            expect(
                msg.toLowerCase(),
                "Oracle scheme should be ON but it is OFF.",
            ).toContain("✅");

            msg = await sendUserRequestAndWaitForResponse(
                `@config schema --off oracle`,
                mainWindow,
            );

            expect(
                msg.toLowerCase(),
                "Oracle schema should be OFF but is is ON.",
            ).toContain("❌");

            msg = await sendUserRequestAndWaitForResponse(
                `@config dev off`,
                mainWindow,
            );

            expect(
                msg.toLowerCase(),
                "Dev mode was not turned off as expected.",
            ).toBe("development mode is disabled.");
        });
    });
});

// TODO: Test action correction
