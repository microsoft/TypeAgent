// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test, { expect, Page } from "@playwright/test";
import { startShell, exitAndAwaitCleanShutdown } from "./testHelper";

// Only one shell instance per worker can be active at a time, so run serially.
test.describe.configure({ mode: "serial" });

test.describe("Shell startup/shutdown", () => {
    test(
        "starts up and shuts down cleanly",
        { tag: "@smoke" },
        async ({}, testInfo) => {
            console.log(`Running test '${testInfo.title}'`);

            // Startup: launch and wait for the chat view + dispatcher to become
            // ready. startShell throws if the chat input never becomes editable
            // or the dispatcher never signals ready, so a successful return
            // already asserts a proper startup.
            const mainWindow: Page = await startShell();

            // Explicit sanity-check that the chat input is present and editable.
            const input = mainWindow.locator("#phraseDiv");
            await expect(input).toBeVisible();
            await expect(input).toHaveAttribute("contenteditable", "true");

            // Shutdown: the user-facing @exit must terminate the process on its
            // own within the budget, with no force-kill required. This guards
            // against shutdown-hang regressions (e.g. in-flight work blocking
            // the dispatcher's shutdown queue-drain). exitAndAwaitCleanShutdown
            // throws \u2014 failing this test \u2014 if the process does not exit in time.
            const elapsedMs = await exitAndAwaitCleanShutdown(mainWindow, 30000);
            console.log(`Shell shut down cleanly in ${elapsedMs}ms`);
        },
    );
});
