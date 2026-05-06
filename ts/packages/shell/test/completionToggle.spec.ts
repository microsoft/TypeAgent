// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test, { expect, Page } from "@playwright/test";
import { runTestCallback } from "./testHelper";

// Annotate entire file as serial.
test.describe.configure({ mode: "serial" });

const inputSelector = "#phraseDiv";
const toggleSelector = ".chat-input > .completion-toggle";

/**
 * Types text character-by-character into the chat input to trigger
 * completion (fill() may not trigger the input events the completion
 * system listens to).
 */
async function typeSlowly(page: Page, text: string) {
    const input = page.locator(inputSelector);
    await input.focus();
    for (const ch of text) {
        await page.keyboard.type(ch, { delay: 80 });
    }
}

/**
 * Waits for command completion to be active (dropdown mode).
 */
async function waitForCommandCompletion(page: Page, timeout = 15000) {
    const toggle = page.locator(toggleSelector);
    await toggle.waitFor({ state: "visible", timeout });
    await expect(toggle).toHaveText("▼", { timeout });
    await expect(toggle).toHaveClass(/completion-toggle-collapse/, { timeout });
    return toggle;
}

test.describe("Completion Mode Toggle", () => {
    test("command completion shows dropdown toggle for @ input", async () => {
        await runTestCallback(async (mainWindow: Page) => {
            // Type a partial @ command to trigger command completion
            await typeSlowly(mainWindow, "@con");

            // @-prefixed input remains in dropdown mode.
            const toggle = await waitForCommandCompletion(mainWindow);

            // The toggle should be attached to .chat-input
            await expect(toggle).toBeAttached();

            // Inline ghost text should not appear for @-prefixed input.
            const inlineArea = mainWindow.locator(
                `${inputSelector} .inline-completion-area`,
            );
            await expect(inlineArea).not.toBeAttached();

            // Clear input for clean shutdown
            await mainWindow.keyboard.press("Escape");
        });
    });

    test("clicking command toggle keeps dropdown mode", async () => {
        await runTestCallback(async (mainWindow: Page) => {
            // Type a partial @ command to trigger command completion
            await typeSlowly(mainWindow, "@con");

            await waitForCommandCompletion(mainWindow);

            // Clicking the toggle should keep command completion in dropdown mode.
            await mainWindow.locator(toggleSelector).dispatchEvent("mousedown");

            const toggle = await waitForCommandCompletion(mainWindow);
            await expect(toggle).toHaveText("▼");

            // Inline ghost text should be gone
            const inlineArea = mainWindow.locator(
                `${inputSelector} .inline-completion-area`,
            );
            await expect(inlineArea).not.toBeAttached();

            // Clean up
            await mainWindow.keyboard.press("Escape");
        });
    });

    test("repeated command toggle clicks keep dropdown mode", async () => {
        await runTestCallback(async (mainWindow: Page) => {
            // Type a partial @ command to trigger command completion
            await typeSlowly(mainWindow, "@con");

            await waitForCommandCompletion(mainWindow);
            await mainWindow.locator(toggleSelector).dispatchEvent("mousedown");
            await mainWindow.locator(toggleSelector).dispatchEvent("mousedown");

            await waitForCommandCompletion(mainWindow);

            const inlineArea = mainWindow.locator(
                `${inputSelector} .inline-completion-area`,
            );
            await expect(inlineArea).not.toBeAttached();

            // Clean up
            await mainWindow.keyboard.press("Escape");
        });
    });

    test("command completion remains selectable after toggle click", async () => {
        await runTestCallback(async (mainWindow: Page) => {
            // Type a partial @ command to trigger command completion
            await typeSlowly(mainWindow, "@con");

            await waitForCommandCompletion(mainWindow);
            await mainWindow.locator(toggleSelector).dispatchEvent("mousedown");
            await waitForCommandCompletion(mainWindow);

            // Verify completion remains actionable by keyboard after toggling.
            const input = mainWindow.locator(inputSelector);
            await mainWindow.keyboard.press("Tab");
            await mainWindow.keyboard.press("Tab");
            await expect(async () => {
                const currentText = (await input.innerText())
                    .replace(/\u00a0/g, " ")
                    .trim();
                expect(currentText.length).toBeGreaterThan("@con".length);
                expect(currentText.startsWith("@")).toBe(true);
            }).toPass({
                timeout: 15000,
            });

            // Clean up
            await mainWindow.keyboard.press("Escape");
        });
    });
});
