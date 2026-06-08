// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test, { expect, Page } from "@playwright/test";
import { runTestCallback } from "./testHelper";

// Annotate entire file as serial.
test.describe.configure({ mode: "serial" });

const inputSelector = "#phraseDiv";

/**
 * Enables opt-in tracing in chat-ui's PartialCompletion by setting the
 * `__partialCompletionTrace` flag it checks before emitting console.debug
 * output.  Once enabled, every completion `requestUpdate()` logs either
 * "content changed: ..." (an update was posted to the host) or "selection not
 * at end" (the update was suppressed because the caret left the end of the
 * input).  Playwright intercepts these messages to assert that each keystroke
 * triggers exactly one update.
 */
async function enablePartialDebug(page: Page) {
    await page.evaluate(() => {
        (
            globalThis as { __partialCompletionTrace?: boolean }
        ).__partialCompletionTrace = true;
    });
}

/**
 * Collects console messages whose text includes a substring.
 * Returns a live array that accumulates matches.
 */
function collectConsoleMessages(page: Page, substring: string) {
    const messages: string[] = [];
    page.on("console", (msg) => {
        const text = msg.text();
        if (text.includes(substring)) {
            messages.push(text);
        }
    });
    return messages;
}

test.describe("Partial completion update suppression", () => {
    test("typing triggers exactly one content-change update per keystroke", async () => {
        await runTestCallback(async (mainWindow: Page) => {
            await enablePartialDebug(mainWindow);

            const contentChanged = collectConsoleMessages(
                mainWindow,
                "content changed",
            );

            const input = mainWindow.locator(inputSelector);
            await input.focus();

            await mainWindow.keyboard.type("p", { delay: 0 });

            // A single keystroke posts exactly one host update.
            await expect(async () => {
                expect(contentChanged.length).toBe(1);
            }).toPass({ timeout: 2000 });

            // Confirm no straggling echoes slip through after settling.
            await mainWindow.waitForTimeout(500);
            expect(contentChanged.length).toBe(1);

            await mainWindow.keyboard.press("Escape");
        });
    });

    test("second keystroke also triggers exactly one content-change update", async () => {
        await runTestCallback(async (mainWindow: Page) => {
            await enablePartialDebug(mainWindow);

            const input = mainWindow.locator(inputSelector);
            await input.focus();

            // Type first character and let it settle.
            await mainWindow.keyboard.type("p", { delay: 0 });

            await expect(async () => {
                expect(
                    await mainWindow.evaluate(() =>
                        document
                            .querySelector("#phraseDiv")
                            ?.textContent?.includes("p"),
                    ),
                ).toBe(true);
            }).toPass({ timeout: 2000 });

            // Start collecting after the first keystroke has settled.
            const contentChanged = collectConsoleMessages(
                mainWindow,
                "content changed",
            );

            await mainWindow.keyboard.type("l", { delay: 0 });

            await expect(async () => {
                expect(contentChanged.length).toBe(1);
            }).toPass({ timeout: 2000 });

            await mainWindow.waitForTimeout(500);
            expect(contentChanged.length).toBe(1);

            await mainWindow.keyboard.press("Escape");
        });
    });

    test("backspace triggers exactly one content-change update", async () => {
        await runTestCallback(async (mainWindow: Page) => {
            await enablePartialDebug(mainWindow);

            const input = mainWindow.locator(inputSelector);
            await input.focus();

            // Type two characters first.
            await mainWindow.keyboard.type("pl", { delay: 50 });

            await expect(async () => {
                expect(
                    await mainWindow.evaluate(() =>
                        document
                            .querySelector("#phraseDiv")
                            ?.textContent?.includes("pl"),
                    ),
                ).toBe(true);
            }).toPass({ timeout: 2000 });

            // Start collecting after the initial typing has settled.
            const contentChanged = collectConsoleMessages(
                mainWindow,
                "content changed",
            );

            await mainWindow.keyboard.press("Backspace");

            await expect(async () => {
                expect(contentChanged.length).toBe(1);
            }).toPass({ timeout: 2000 });

            await mainWindow.waitForTimeout(500);
            expect(contentChanged.length).toBe(1);

            await mainWindow.keyboard.press("Escape");
        });
    });
});
