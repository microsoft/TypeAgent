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
    test("typing triggers exactly one update per keystroke", async () => {
        await runTestCallback(async (mainWindow: Page) => {
            await enablePartialDebug(mainWindow);

            const contentTrue = collectConsoleMessages(
                mainWindow,
                "update(contentChanged=true)",
            );
            const contentFalse = collectConsoleMessages(
                mainWindow,
                "update(contentChanged=false)",
            );

            const input = mainWindow.locator(inputSelector);
            await input.focus();

            await mainWindow.keyboard.type("p", { delay: 0 });

            await expect(async () => {
                expect(contentTrue.length).toBe(1);
            }).toPass({ timeout: 2000 });
            expect(contentFalse.length).toBe(0);

            await mainWindow.keyboard.press("Escape");
        });
    });

    test("second keystroke also triggers exactly one update", async () => {
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
                "update(contentChanged=true)",
            );
            const contentFalse = collectConsoleMessages(
                mainWindow,
                "update(contentChanged=false)",
            );

            await mainWindow.keyboard.type("l", { delay: 0 });

            await expect(async () => {
                expect(contentTrue.length).toBe(1);
            }).toPass({ timeout: 2000 });
            expect(contentFalse.length).toBe(0);

            await mainWindow.keyboard.press("Escape");
        });
    });

    test("backspace triggers exactly one update", async () => {
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
                "update(contentChanged=true)",
            );
            const contentFalse = collectConsoleMessages(
                mainWindow,
                "update(contentChanged=false)",
            );

            await mainWindow.keyboard.press("Backspace");

            await expect(async () => {
                expect(contentTrue.length).toBe(1);
            }).toPass({ timeout: 2000 });
            expect(contentFalse.length).toBe(0);

            await mainWindow.keyboard.press("Escape");
        });
    });
});
