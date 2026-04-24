// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test, { expect, Page } from "@playwright/test";
import { runTestCallback } from "./testHelper";

// Annotate entire file as serial.
test.describe.configure({ mode: "serial" });

const inputSelector = "#phraseDiv";

/**
 * Enables the `typeagent:shell:partial` debug namespace at runtime via
 * the `__debug` factory exposed on globalThis by partial.ts.  Once
 * enabled, all `debug(...)` calls in the module produce console.debug
 * output that Playwright can intercept.
 */
async function enablePartialDebug(page: Page) {
    await page.evaluate(() => {
        const dbg = (window as any).__debug;
        if (dbg && typeof dbg.enable === "function") {
            dbg.enable("typeagent:shell:partial");
        }
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

            const contentTrue = collectConsoleMessages(
                mainWindow,
                "content changed",
            );
            const updateEntries = collectConsoleMessages(
                mainWindow,
                "update entry:",
            );
            const updateSkipped = collectConsoleMessages(
                mainWindow,
                "update skipped:",
            );
            const updateHidden = collectConsoleMessages(
                mainWindow,
                "selection not at end",
            );

            const input = mainWindow.locator(inputSelector);
            await input.focus();

            await mainWindow.keyboard.type("p", { delay: 0 });

            await expect(async () => {
                expect(contentTrue.length).toBe(1);
            }).toPass({ timeout: 2000 });

            // Wait a beat for any straggling selectionchange echoes.
            await mainWindow.waitForTimeout(500);

            // Every update() call must either be the content-change
            // path, deduped by the previousInput guard, or hidden
            // because selection moved away from the end.  No call
            // may slip through to recompute direction.
            expect(updateEntries.length).toBe(
                contentTrue.length + updateSkipped.length + updateHidden.length,
            );

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
            const contentTrue = collectConsoleMessages(
                mainWindow,
                "content changed",
            );
            const updateEntries = collectConsoleMessages(
                mainWindow,
                "update entry:",
            );
            const updateSkipped = collectConsoleMessages(
                mainWindow,
                "update skipped:",
            );
            const updateHidden = collectConsoleMessages(
                mainWindow,
                "selection not at end",
            );

            await mainWindow.keyboard.type("l", { delay: 0 });

            await expect(async () => {
                expect(contentTrue.length).toBe(1);
            }).toPass({ timeout: 2000 });

            // Wait a beat for any straggling selectionchange echoes.
            await mainWindow.waitForTimeout(500);

            // Every update() call must either be the content-change
            // path, deduped by the previousInput guard, or hidden.
            expect(updateEntries.length).toBe(
                contentTrue.length + updateSkipped.length + updateHidden.length,
            );

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
            const contentTrue = collectConsoleMessages(
                mainWindow,
                "content changed",
            );
            const updateEntries = collectConsoleMessages(
                mainWindow,
                "update entry:",
            );
            const updateSkipped = collectConsoleMessages(
                mainWindow,
                "update skipped:",
            );
            const updateHidden = collectConsoleMessages(
                mainWindow,
                "selection not at end",
            );

            await mainWindow.keyboard.press("Backspace");

            await expect(async () => {
                expect(contentTrue.length).toBe(1);
            }).toPass({ timeout: 2000 });

            // Wait a beat for any straggling selectionchange echoes.
            await mainWindow.waitForTimeout(500);

            // Every update() call must either be the content-change
            // path, deduped by the previousInput guard, or hidden.
            expect(updateEntries.length).toBe(
                contentTrue.length + updateSkipped.length + updateHidden.length,
            );

            await mainWindow.keyboard.press("Escape");
        });
    });
});
