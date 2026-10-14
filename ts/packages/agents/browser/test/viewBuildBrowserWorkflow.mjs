// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import puppeteer from "puppeteer";

export async function verifyViewBuildBrowserWorkflow(
    base,
    corpusId,
    kind,
    service,
) {
    const browser = await puppeteer.launch({
        headless: true,
        ...(process.env.TYPEAGENT_TEST_BROWSER_EXECUTABLE
            ? { executablePath: process.env.TYPEAGENT_TEST_BROWSER_EXECUTABLE }
            : {}),
    });
    try {
        const page = await browser.newPage();
        const requests = [];
        page.on("response", async (response) => {
            if (!response.url().endsWith("/api/views/invoke")) return;
            const request = JSON.parse(response.request().postData());
            requests.push({
                method: request.method,
                status: response.status(),
            });
        });
        const click = async (text) => {
            await page.waitForFunction(
                (label) =>
                    [...document.querySelectorAll("button")].some(
                        (button) =>
                            button.textContent === label && !button.disabled,
                    ),
                {},
                text,
            );
            const handle = await page.evaluateHandle(
                (label) =>
                    [...document.querySelectorAll("button")].find(
                        (button) =>
                            button.textContent === label &&
                            button.getClientRects().length > 0,
                    ),
                text,
            );
            const button = handle.asElement();
            assert.ok(button, `No visible button: ${text}`);
            await button.click();
            await handle.dispose();
        };
        const labels = {
            wiki: "Knowledge wiki",
            projectBrief: "Project brief",
            timeline: "Evidence-linked timeline",
            troubleshootingGuide: "Troubleshooting guide",
        };
        await page.goto(`${base}/library/memoryHub.html#/views`, {
            waitUntil: "domcontentloaded",
        });
        await click("Build views");
        await page.waitForSelector('[aria-label="Build collection"]');
        await page.select('[aria-label="Build collection"]', corpusId);
        await page.waitForSelector('[aria-label="Select all sources"]');
        await page.click(`input[aria-label="${labels[kind]}"]`);
        await page.click('[aria-label="Select all sources"]');
        assert.equal(
            await page.$eval(
                '[aria-label="Select all sources"]',
                (el) => el.checked,
            ),
            true,
        );
        assert.equal(
            await page.$$eval(
                'input[aria-label^="Use "]:not([aria-label^="Use event "])',
                (els) => els.every((el) => el.checked),
            ),
            true,
        );
        console.log(
            `Browser ${kind}: collection, kind and Select all verified`,
        );
        await page.select(
            '[aria-label="Build auto-publish after build"]',
            "off",
        );
        await click("Continue to confirmation");
        await page.waitForSelector(".hub-view-confirmation");
        assert.equal(
            await page.$eval(".hub-view-confirmation", (el) =>
                el.textContent.includes("Confirm exact inputs"),
            ),
            true,
        );
        await click("Back to selection");
        await page.waitForFunction(
            () => !document.querySelector(".hub-view-confirmation"),
        );
        assert.equal(
            await page.$eval(
                '[aria-label="Select all sources"]',
                (el) => el.checked,
            ),
            true,
        );
        await click("Continue to confirmation");
        await page.waitForSelector(".hub-view-confirmation");
        assert.equal(
            requests.some((request) => request.method === "memoryBuildViews"),
            false,
        );
        console.log(
            `Browser ${kind}: confirmation and Back preserve inputs; no premature build`,
        );
        const before = (await service.listViews(corpusId)).views.map(
            (view) => view.viewId,
        );
        await click("Start build");
        await page.waitForFunction(
            () => !document.querySelector(".hub-view-confirmation"),
        );
        await page.waitForFunction(
            () =>
                document
                    .querySelector("#hubViewActivity .hub-view-job > p")
                    ?.textContent.startsWith("complete"),
            { timeout: 60000 },
        );
        const saved = (await service.listViews(corpusId)).views.find(
            (view) => !before.includes(view.viewId),
        );
        assert.ok(saved, "Browser Start build must persist a new view");
        assert.equal(saved.content.kind, kind);
        console.log(
            `Browser ${kind}: Start build, completed receipt and persisted output verified`,
        );
        await page.goto(
            `${base}/library/memoryHub.html#/views/${encodeURIComponent(corpusId)}/${encodeURIComponent(saved.viewId)}`,
            { waitUntil: "domcontentloaded" },
        );
        await click("Edit");
        await page.waitForFunction(() =>
            [...document.querySelectorAll("button")].some(
                (button) =>
                    button.textContent === "Save explicit edits" &&
                    button.getClientRects().length > 0,
            ),
        );
        assert.equal(
            requests.filter((request) => request.status >= 400).length,
            0,
            JSON.stringify(requests),
        );
        console.log(
            `Browser ${kind}: saved reader and editor open; all HTTP invokes succeeded`,
        );
    } finally {
        await browser.close();
    }
}
