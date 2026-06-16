// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test, { expect, Page } from "@playwright/test";
import { runTestCallback } from "./testHelper";

test("conversation bar is hidden in local-only mode", async () => {
    await runTestCallback(async (mainWindow: Page) => {
        const bar = mainWindow.locator(".conversation-name-bar");
        await expect(bar).toBeHidden({ timeout: 30000 });
    }, true);
});
