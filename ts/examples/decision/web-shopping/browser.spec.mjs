import assert from "node:assert/strict";
import test, { before, after, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executor, openBrowser, startFixture } from "./browser.mjs";
import {
    assertFresh,
    decisionObserve,
    explicitAct,
    observeHost,
    requireLocal,
} from "./observer.mjs";
import { offlineClient, options, runShopping } from "./run.mjs";
import {
    options as recordingOptions,
    recordAll,
    runnerArguments,
    scenarios,
} from "../record-demos.mjs";

let fixture;
let browser;
before(async () => {
    fixture = await startFixture();
    browser = await openBrowser();
});
after(async () => {
    await browser?.close();
    await fixture?.close();
});
beforeEach(async () => {
    await browser.page.goto(`${fixture.url}/shopping`);
});

test("recording is opt-in and refuses invalid or preexisting output directories", async () => {
    assert.equal(browser.page.video(), null);
    assert.equal(browser.videoPath, undefined);
    await assert.rejects(
        openBrowser({ recordDirectory: "" }),
        /invalid_record_directory/,
    );
    const directory = await mkdtemp(join(tmpdir(), "decision-recording-test-"));
    try {
        await assert.rejects(
            openBrowser({ recordDirectory: directory }),
            /EEXIST/,
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("recording batch previews eight bounded scenarios without launching or writing", async () => {
    const values = recordingOptions([
        "--output-dir",
        "not-created",
        "--dry-run",
        "--live",
    ]);
    const report = await recordAll(values);
    assert.equal(report.recording, false);
    assert.equal(report.scenarios.length, 8);
    assert.equal(new Set(scenarios.map((item) => item.id)).size, 8);
    for (const scenario of scenarios) {
        const args = runnerArguments(scenario, values);
        assert.ok(args.includes("--demo"));
        assert.ok(args.includes("--record-dir"));
        assert.ok(args.includes("--live"));
        assert.ok([1, 2].includes(scenario.limit));
    }
    assert.equal(recordingOptions(["--output-dir", "example"]).live, false);
    assert.throws(() => options(["--demo"]), /requires --record-dir/);
});

test("Playwright explicit fill/search/filter/detail uses the bounded executor", async () => {
    for (const [target, argument] of [
        ["search", "drill"],
        ["apply-search", ""],
        ["cordless-filter", ""],
        ["drill-detail", ""],
    ]) {
        const snapshot = await observeHost(browser.page, { argument });
        const candidate = snapshot.candidates.find(
            (item) => item.action.selector === `[data-fixture-id="${target}"]`,
        );
        assert.ok(candidate, target);
        assert.equal(
            (
                await explicitAct(
                    browser.executor,
                    browser.page,
                    snapshot,
                    candidate,
                )
            ).success,
            true,
        );
    }
    assert.deepEqual(
        await browser.page.evaluate(() => ({
            search: document.querySelector('[data-fixture-id="search"]').value,
            hidden: document.querySelector('[data-name="corded saw"]').hidden,
            detail: document.querySelector("dialog").open,
        })),
        { search: "drill", hidden: true, detail: true },
    );
    assert.equal(browser.executor, executor);
    assert.equal("stagehand" in browser, false);
    assert.equal("counter" in browser, false);
});

test("decision IDs resolve only into the host's explicit Actions", async () => {
    const snapshot = await observeHost(browser.page);
    const choice = await decisionObserve(
        snapshot,
        offlineClient((evidence) => evidence.text.trim() === "Cordless only"),
        "Filter cordless",
    );
    assert.equal(
        (
            await explicitAct(
                browser.executor,
                browser.page,
                snapshot,
                choice.candidate,
            )
        ).success,
        true,
    );
});

test("DOM mutation, equal-looking replacement, and navigation expire refs", async () => {
    for (const mutation of ["text", "replace", "reload"]) {
        await browser.page.goto(`${fixture.url}/shopping`);
        const snapshot = await observeHost(browser.page);
        const candidate = snapshot.candidates.find((item) =>
            item.action.selector.includes("apply-search"),
        );
        if (mutation === "reload") {
            await browser.page.reload();
            await observeHost(browser.page);
        } else
            await browser.page.evaluate((mutation) => {
                const node = document.querySelector(
                    '[data-fixture-id="apply-search"]',
                );
                if (mutation === "text") node.textContent = "Changed";
                else node.replaceWith(node.cloneNode(true));
            }, mutation);
        await assert.rejects(
            assertFresh(browser.page, snapshot, candidate),
            /stale_target/,
        );
    }
});

test("empty/canvas and hidden controls do not create invented candidates", async () => {
    await browser.page.evaluate(() => {
        document.querySelector("main").innerHTML =
            '<canvas width="120" height="120"></canvas><button hidden data-shopping-action="click" data-fixture-id="hidden">Hidden</button>';
    });
    assert.equal((await observeHost(browser.page)).candidates.length, 0);
    assert.throws(
        () => requireLocal("https://www.homedepot.com"),
        /local_fixture_only/,
    );
});

test("bounded executor rejects unsupported methods and supports host-issued Enter", async () => {
    for (const action of [
        { selector: "body", method: "evaluate", arguments: [] },
        { selector: "body", method: "press", arguments: ["Control+L"] },
        { selector: "body", method: "fill", arguments: [42] },
    ])
        await assert.rejects(
            executor.act(action, { page: browser.page }),
            /unsupported_host_action/,
        );
    await browser.page.evaluate(() => {
        const input = document.querySelector('[data-fixture-id="search"]');
        input.dataset.shoppingAction = "press";
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") input.dataset.entered = "true";
        });
    });
    const snapshot = await observeHost(browser.page, { argument: "Enter" });
    const candidate = snapshot.candidates.find(
        (item) => item.action.method === "press",
    );
    await explicitAct(browser.executor, browser.page, snapshot, candidate);
    assert.equal(
        await browser.page
            .locator('[data-fixture-id="search"]')
            .getAttribute("data-entered"),
        "true",
    );
});

test("native and rerank are unavailable even for live or dry-run requests", async () => {
    for (const variant of ["native", "rerank"])
        for (const mode of [[], ["--dry-run"], ["--live"]]) {
            const report = await runShopping(
                options(["--variant", variant, ...mode]),
            );
            assert.equal(report.status, "unavailable");
            assert.match(report.reason, /Stagehand was removed/);
            assert.match(
                report.reason,
                /custom client implementation, not new provider secrets/,
            );
            assert.equal(report.modelInvocations, 0);
        }
});

test("owned desktop/mobile Playwright screenshots render and fit", async () => {
    const page = browser.page;
    assert.ok(page);
    for (const [name, width, height] of [
        ["desktop", 1100, 800],
        ["mobile", 390, 844],
    ]) {
        await page.setViewportSize({ width, height });
        await page
            .getByRole("heading", { name: "Local Tool Catalog" })
            .waitFor();
        assert.equal(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
            ),
            true,
        );
        const image = await page.screenshot({
            path: fileURLToPath(new URL(`./${name}.png`, import.meta.url)),
            fullPage: true,
        });
        assert.ok(image.length > 4000);
    }
});
