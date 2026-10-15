// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect, test, type Page } from "@playwright/test";

type BrowserTab = {
    id: string;
    title: string;
    url: string;
    favicon?: string;
};

type IpcMessage = { channel: string; args: unknown[] };
type IpcListener = (event: undefined, data: unknown) => void;

declare global {
    interface Window {
        viewHostTest: {
            notify: (channel: string, data: unknown) => void;
            messages: IpcMessage[];
        };
    }
}

const viewHostUrl = new URL("../src/renderer/viewHost.html", import.meta.url)
    .href;
const firstTab = {
    id: "first",
    title: "First tab",
    url: "https://example.test/page",
    favicon: "https://example.test/icon.png",
} satisfies BrowserTab;

test.beforeEach(async ({ page }) => {
    await page.route("**/*", async (route) => {
        if (route.request().url().startsWith("file:")) {
            await route.continue();
        } else if (route.request().resourceType() === "image") {
            await route.fulfill({
                contentType: "image/png",
                body: Buffer.from(
                    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=",
                    "base64",
                ),
            });
        } else {
            await route.abort();
        }
    });
    await page.addInitScript(() => {
        const listeners = new Map<string, IpcListener>();
        const messages: IpcMessage[] = [];
        window.viewHostTest = {
            notify(channel, data) {
                const listener = listeners.get(channel);
                if (!listener) {
                    throw new Error(`No listener for ${channel}`);
                }
                listener(undefined, data);
            },
            messages,
        };
        Object.defineProperty(window, "electron", {
            value: {
                ipcRenderer: {
                    on(channel: string, listener: IpcListener) {
                        listeners.set(channel, listener);
                    },
                    send(channel: string, ...args: unknown[]) {
                        messages.push({ channel, args });
                    },
                    invoke(channel: string) {
                        throw new Error(
                            `Unexpected IPC invocation: ${channel}`,
                        );
                    },
                },
            },
        });
    });
    await page.goto(viewHostUrl);
});

async function updateTabs(
    page: Page,
    tabs: BrowserTab[],
    activeTabId = tabs[0]?.id ?? null,
) {
    await page.evaluate(
        (data) => window.viewHostTest.notify("browser-tabs-updated", data),
        { tabs, activeTabId },
    );
}

for (const { field, value } of [
    {
        field: "title",
        value: `<img src="data:," onerror="window.electron.ipcRenderer.send('tab-title-message')">Page <b>title</b> & "quotes"`,
    },
    {
        field: "url",
        value: `https://example.test/" onpointerenter="window.electron.ipcRenderer.send('tab-url-message')`,
    },
    {
        field: "favicon",
        value: `https://example.test/icon.png" onload="window.electron.ipcRenderer.send('tab-icon-message')`,
    },
]) {
    test(`keeps ${field} metadata in its intended DOM property`, async ({
        page,
    }) => {
        const tab = { ...firstTab, [field]: value };
        await updateTabs(page, [tab]);

        const tabElement = page.locator(".tab");
        const title = tabElement.locator(".tab-title");
        expect(await title.textContent()).toBe(tab.title);
        await expect(title).toHaveAttribute("title", tab.url);
        await expect(title.locator("*")).toHaveCount(0);
        await expect(tabElement.locator(":scope > *")).toHaveCount(3);
        await expect(tabElement.locator(".tab-favicon")).toHaveAttribute(
            "src",
            tab.favicon,
        );
        await expect(
            tabElement.locator("[onerror], [onload], [onpointerenter]"),
        ).toHaveCount(0);
        await title.dispatchEvent("pointerenter");
        expect(await page.evaluate(() => window.viewHostTest.messages)).toEqual(
            [],
        );
    });
}

test("updates tab labels without interpreting their text", async ({ page }) => {
    await updateTabs(page, [firstTab]);
    const updated = {
        ...firstTab,
        title: '  <strong>Updated</strong> & "quoted" \u03c0\u4e2d\u6587  ',
        url: 'https://example.test/path?value="<text>"&other=1',
    };
    await updateTabs(page, [updated]);

    expect(await page.locator(".tab-title").textContent()).toBe(updated.title);
    await expect(page.locator(".tab-title")).toHaveAttribute(
        "title",
        updated.url,
    );
    await expect(page.locator(".tab-title *")).toHaveCount(0);
    await expect(page.locator(".tab.active")).toHaveAttribute(
        "data-tab-id",
        "first",
    );
});

for (const { label, tab } of [
    { label: "empty", tab: { ...firstTab, title: "", favicon: "" } },
    {
        label: "missing",
        tab: { id: firstTab.id, title: "", url: firstTab.url },
    },
]) {
    test(`uses the existing defaults for ${label} favicon metadata`, async ({
        page,
    }) => {
        await updateTabs(page, [tab]);

        await expect(page.locator(".tab-title")).toHaveText("New Tab");
        await expect(page.locator(".tab-favicon")).toHaveAttribute(
            "src",
            /^data:image\/svg\+xml,/,
        );
        await expect(page.locator(".tab-favicon")).toHaveAttribute("alt", "");
    });
}

test("replaces a failed favicon with the default icon", async ({ page }) => {
    await updateTabs(page, [firstTab]);
    const favicon = page.locator(".tab-favicon");
    await expect(favicon).toHaveJSProperty("complete", true);
    await expect(favicon).toHaveJSProperty("naturalWidth", 1);
    await favicon.dispatchEvent("error");
    await expect(favicon).toHaveAttribute("src", /^data:image\/svg\+xml,/);
    const fallback = await favicon.getAttribute("src");
    await favicon.dispatchEvent("error");
    expect(await favicon.getAttribute("src")).toBe(fallback);
});

test("preserves switching, close-button, and middle-click behavior", async ({
    page,
}) => {
    const secondTab = { ...firstTab, id: "second", title: "Second tab" };
    await updateTabs(page, [firstTab, secondTab]);
    await page.locator('[data-tab-id="second"] .tab-title').click();
    await expect(page.locator(".tab.active")).toHaveAttribute(
        "data-tab-id",
        "second",
    );
    await page
        .locator('[data-tab-id="second"] .tab-close i')
        .dispatchEvent("click");
    expect(await page.evaluate(() => window.viewHostTest.messages)).toEqual([
        { channel: "browser-switch-tab", args: ["second"] },
        { channel: "browser-close-tab", args: ["second"] },
    ]);

    await updateTabs(page, [firstTab]);
    await page.evaluate(() => window.viewHostTest.messages.splice(0));
    await page.locator(".tab").dispatchEvent("auxclick", { button: 2 });
    expect(await page.evaluate(() => window.viewHostTest.messages)).toEqual([]);
    await page.locator(".tab").dispatchEvent("auxclick", { button: 1 });
    expect(await page.evaluate(() => window.viewHostTest.messages)).toEqual([
        { channel: "browser-close-tab", args: ["first"] },
        { channel: "toggle-layout", args: [] },
    ]);
});

test("preserves navigation state and returning to chat-only mode", async ({
    page,
}) => {
    await page.evaluate(
        (tabs) =>
            window.viewHostTest.notify("browser-tabs-updated", {
                tabs,
                activeTabId: "first",
                navigationState: { canGoBack: true, canGoForward: false },
            }),
        [firstTab],
    );
    await expect(page.locator("#back-btn")).toBeEnabled();
    await expect(page.locator("#forward-btn")).toBeDisabled();
    await page.locator("#reload-btn").click();
    await page.locator("#new-tab-btn").click();
    expect(await page.evaluate(() => window.viewHostTest.messages)).toEqual([
        { channel: "browser-reload", args: [] },
        { channel: "browser-new-tab", args: [] },
    ]);

    await updateTabs(page, []);
    await expect(page.locator(".tab")).toHaveCount(0);
    await expect(page.locator("#title-bar")).toHaveClass(/chat-only-mode/);
});
