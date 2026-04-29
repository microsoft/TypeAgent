// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Playwright integration tests for shell deferred-interaction UI.
 *
 * These tests exercise the `requestInteraction` / `interactionResolved` /
 * `interactionCancelled` handlers that were implemented in main.ts to give the
 * shell parity with the CLI's connected-mode interaction support.
 *
 * The tests use `window.__clientIO__` — exposed by registerClient() in main.ts
 * — to simulate the server pushing interaction events without requiring a live
 * agent-server connection.
 *
 * Background: when the shell connects to a SharedDispatcher (agent-server), the
 * server broadcasts `requestInteraction` to every connected client.  The first
 * client to call `respondToInteraction` wins; the server then broadcasts
 * `interactionResolved` (or `interactionCancelled` on timeout) to tell the
 * remaining clients to dismiss their open prompts.
 *
 * The unified `"question"` interaction type covers both yes/no and multi-choice
 * prompts — the `askYesNoWithContext` / `popupQuestion` distinction only exists
 * at the SessionContext helper layer, not in the protocol.
 */

import test, { expect, Page } from "@playwright/test";
import { runTestCallback } from "./testHelper";

// Annotate entire file as serial — interactions share renderer state.
test.describe.configure({ mode: "serial" });

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Inject a `requestInteraction` call into the renderer via the test hook.
 * Returns immediately (fire-and-forget, matching the real server behaviour).
 */
async function pushInteraction(
    page: Page,
    id: string,
    choices: string[],
    message = "Are you sure?",
): Promise<void> {
    await page.evaluate(
        ({ id, choices, message }) => {
            const clientIO = (window as any).__clientIO__;
            if (!clientIO) throw new Error("__clientIO__ not exposed");
            clientIO.requestInteraction({
                interactionId: id,
                type: "question",
                message,
                choices,
                source: "test",
                timestamp: Date.now(),
            });
        },
        { id, choices, message },
    );
}

/** Simulate the server telling this client that another client already answered. */
async function resolveInteraction(page: Page, id: string): Promise<void> {
    await page.evaluate((id) => {
        (window as any).__clientIO__?.interactionResolved(id, 0);
    }, id);
}

/** Simulate the server cancelling an interaction (e.g. timeout). */
async function cancelInteraction(page: Page, id: string): Promise<void> {
    await page.evaluate((id) => {
        (window as any).__clientIO__?.interactionCancelled(id);
    }, id);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("Shell deferred-interaction UI", () => {
    test("binary yes/no question renders Yes and No buttons", async ({}) => {
        await runTestCallback(async (page: Page) => {
            await pushInteraction(page, "int-yesno-1", ["Yes", "No"]);

            // The Yes/No choice panel should appear inside the chat scroll region.
            const choicePanel = page.locator(".choice-panel").first();
            await choicePanel.waitFor({ state: "visible", timeout: 5000 });

            // Both choice buttons should be present.
            const buttons = choicePanel.locator(".choice-button");
            await expect(buttons).toHaveCount(2);
        });
    });

    test("multi-choice question renders all choice buttons", async ({}) => {
        await runTestCallback(async (page: Page) => {
            await pushInteraction(page, "int-multi-1", [
                "Alpha",
                "Beta",
                "Gamma",
            ]);

            const choicePanel = page.locator(".choice-panel").last();
            await choicePanel.waitFor({ state: "visible", timeout: 5000 });

            const buttons = choicePanel.locator(".choice-button");
            await expect(buttons).toHaveCount(3);
        });
    });

    test("clicking a choice button dismisses the panel", async ({}) => {
        await runTestCallback(async (page: Page) => {
            await pushInteraction(page, "int-click-1", ["Yes", "No"]);

            const choicePanel = page.locator(".choice-panel").last();
            await choicePanel.waitFor({ state: "visible", timeout: 5000 });

            // Click the first choice button (Yes).
            await choicePanel.locator(".choice-button").first().click();

            // The panel should be removed from the DOM.
            await choicePanel.waitFor({ state: "detached", timeout: 5000 });
        });
    });

    test("interactionResolved dismisses the pending panel", async ({}) => {
        await runTestCallback(async (page: Page) => {
            await pushInteraction(page, "int-resolved-1", ["Yes", "No"]);

            const choicePanel = page.locator(".choice-panel").last();
            await choicePanel.waitFor({ state: "visible", timeout: 5000 });

            // Simulate another client answering.
            await resolveInteraction(page, "int-resolved-1");

            // The panel should disappear.
            await choicePanel.waitFor({ state: "detached", timeout: 5000 });

            // A dismissal notice should appear in the chat.
            await expect(
                page.locator("text=answered by another client").last(),
            ).toBeVisible({ timeout: 5000 });
        });
    });

    test("interactionCancelled dismisses the pending panel", async ({}) => {
        await runTestCallback(async (page: Page) => {
            await pushInteraction(page, "int-cancel-1", ["Yes", "No"]);

            const choicePanel = page.locator(".choice-panel").last();
            await choicePanel.waitFor({ state: "visible", timeout: 5000 });

            // Simulate the server cancelling (e.g. timeout).
            await cancelInteraction(page, "int-cancel-1");

            // The panel should disappear.
            await choicePanel.waitFor({ state: "detached", timeout: 5000 });

            // A cancellation notice should appear in the chat.
            await expect(
                page.locator("text=interaction cancelled").last(),
            ).toBeVisible({ timeout: 5000 });
        });
    });

    test("resolving an unknown interactionId is a no-op and does not throw", async ({}) => {
        await runTestCallback(async (page: Page) => {
            const result = await page.evaluate(() => {
                try {
                    (window as any).__clientIO__?.interactionResolved(
                        "no-such-id",
                        0,
                    );
                    return "ok";
                } catch (e: any) {
                    return `error: ${e.message}`;
                }
            });
            expect(result).toBe("ok");
        });
    });

    test("cancelling an unknown interactionId is a no-op and does not throw", async ({}) => {
        await runTestCallback(async (page: Page) => {
            const result = await page.evaluate(() => {
                try {
                    (window as any).__clientIO__?.interactionCancelled(
                        "no-such-id",
                    );
                    return "ok";
                } catch (e: any) {
                    return `error: ${e.message}`;
                }
            });
            expect(result).toBe("ok");
        });
    });

    test("resolving one interaction does not affect a concurrent one", async ({}) => {
        await runTestCallback(async (page: Page) => {
            // Start two interactions simultaneously.
            await pushInteraction(page, "int-concurrent-A", ["Yes", "No"]);
            await pushInteraction(page, "int-concurrent-B", ["Yes", "No"]);

            // Wait for both panels to appear.
            const panels = page.locator(".choice-panel");
            await expect(panels).toHaveCount(2, { timeout: 5000 });

            // Resolve A (answered by another client).
            await resolveInteraction(page, "int-concurrent-A");

            // B should still be visible.
            await expect(panels).toHaveCount(1, { timeout: 5000 });
        });
    });
});
