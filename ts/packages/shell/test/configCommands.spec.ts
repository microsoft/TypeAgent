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
                `@config schema calendar`,
                mainWindow,
            );

            expect(
                msg.toLowerCase(),
                "Calendar schema should be ON but it is OFF.",
            ).toContain("✅");

            msg = await sendUserRequestAndWaitForResponse(
                `@config schema --off calendar`,
                mainWindow,
            );

            expect(
                msg.toLowerCase(),
                "Calendar schema should be OFF but it is ON.",
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
