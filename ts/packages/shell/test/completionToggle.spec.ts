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
 * Waits for the inline completion ghost text to appear.
 */
async function waitForInlineCompletion(page: Page, timeout = 10000) {
    return page
        .locator(`${inputSelector} .inline-completion-area`)
        .waitFor({ state: "attached", timeout });
}

/**
 * Waits for the completion toggle to become visible.
 * The toggle is always a direct child of .chat-input regardless of mode.
 */
async function waitForToggle(page: Page, timeout = 10000) {
    const toggle = page.locator(toggleSelector);
    await toggle.waitFor({ state: "visible", timeout });
    return toggle;
}

test.describe("Completion Mode Toggle", () => {
    test("inline completion shows toggle on hover", async () => {
        await runTestCallback(async (mainWindow: Page) => {
            // Type a partial @ command to trigger inline completion
            await typeSlowly(mainWindow, "@con");

            // Wait for inline ghost text to appear
            await waitForInlineCompletion(mainWindow);

            // The toggle should be attached to .chat-input
            const toggle = mainWindow.locator(toggleSelector);
            await expect(toggle).toBeAttached();

            // Toggle should have the expand arrow (▲)
            await expect(toggle).toHaveText("▲");

            // Toggle should have the expand class
            await expect(toggle).toHaveClass(/completion-toggle-expand/);

            // Clear input for clean shutdown
            await mainWindow.keyboard.press("Escape");
        });
    });

    test("clicking inline toggle switches to menu mode", async () => {
        await runTestCallback(async (mainWindow: Page) => {
            // Type a partial @ command to trigger inline completion
            await typeSlowly(mainWindow, "@con");

            // Wait for inline ghost text to appear
            await waitForInlineCompletion(mainWindow);

            // Click the toggle via dispatchEvent to ensure mousedown fires
            await mainWindow.locator(toggleSelector).dispatchEvent("mousedown");

            // The toggle should now show collapse arrow (▼)
            const toggle = await waitForToggle(mainWindow);
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

    test("clicking menu toggle switches back to inline", async () => {
        await runTestCallback(async (mainWindow: Page) => {
            // Type a partial @ command to trigger inline completion
            await typeSlowly(mainWindow, "@con");

            // Wait for inline ghost text to appear
            await waitForInlineCompletion(mainWindow);

            // Switch to menu mode via toggle
            await mainWindow.locator(toggleSelector).dispatchEvent("mousedown");
            await waitForToggle(mainWindow);

            // Click the toggle to switch back to inline
            await mainWindow.locator(toggleSelector).dispatchEvent("mousedown");

            // Inline ghost text should reappear
            await waitForInlineCompletion(mainWindow);

            // Clean up
            await mainWindow.keyboard.press("Escape");
        });
    });

    test("toggle preserves completion items across mode switch", async () => {
        await runTestCallback(async (mainWindow: Page) => {
            // Type a partial @ command to trigger inline completion
            await typeSlowly(mainWindow, "@con");

            // Wait for inline completion
            await waitForInlineCompletion(mainWindow);

            // Read the ghost text content before switching
            const ghostText = await mainWindow
                .locator(`${inputSelector} .inline-ghost`)
                .textContent();
            expect(ghostText).toBeTruthy();

            // Switch to menu mode
            await mainWindow.locator(toggleSelector).dispatchEvent("mousedown");
            await waitForToggle(mainWindow);

            // Switch back to inline
            await mainWindow.locator(toggleSelector).dispatchEvent("mousedown");

            // Wait for inline completion to reappear
            await waitForInlineCompletion(mainWindow);

            // Ghost text should still be present after round-trip
            const ghostTextAfter = await mainWindow
                .locator(`${inputSelector} .inline-ghost`)
                .textContent();
            expect(ghostTextAfter).toBeTruthy();

            // Clean up
            await mainWindow.keyboard.press("Escape");
        });
    });
});
