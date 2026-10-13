import assert from "node:assert/strict";
import test, { before, after, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { openBrowser, startFixture } from "../web-shopping/browser.mjs";
import { offlineClient } from "../web-shopping/run.mjs";
import { createCrosswordActions } from "./crossword.mjs";

let fixture;
let browser;
let calls;
let actions;
const matcher = (evidence, request) =>
    evidence.number === request.match(/clue (\d+)/)?.[1] &&
    evidence.direction === request.match(/\b(across|down)\b/)?.[1];
before(async () => {
    fixture = await startFixture();
    browser = await openBrowser();
});
after(async () => {
    await browser?.close();
    await fixture?.close();
});
beforeEach(async () => {
    await browser.page.goto(`${fixture.url}/crossword`);
    calls = 0;
    const client = offlineClient(matcher);
    actions = createCrosswordActions({
        ...browser,
        client: {
            async decide(...args) {
                calls++;
                return client.decide(...args);
            },
        },
    });
});

test("get reads live clue innerText, not a cached full-puzzle schema", async () => {
    assert.equal(await actions.getClueValue(1, "across"), "1. A feline pet");
    await browser.page.evaluate(() => {
        document.querySelector('[data-fixture-id="clue-1-across"]').innerText =
            "1. Revised live clue";
    });
    assert.equal(
        await actions.getClueValue(1, "across"),
        "1. Revised live clue",
    );
    assert.equal(calls, 2);
});

test("provided answer fills intended direction with verified crossing readback", async () => {
    const down = await actions.enterText("cat", 1, "down");
    assert.deepEqual(down, {
        supplied: "cat",
        normalized: "CAT",
        readback: "CAT",
        crossingsIntact: true,
    });
    const across = await actions.enterText("cat", 1, "across");
    assert.equal(across.readback, "CAT");
    assert.equal(across.crossingsIntact, true);
    assert.equal(
        await browser.page.evaluate(
            () =>
                document.querySelector('[data-cell="3"]').value +
                document.querySelector('[data-cell="6"]').value,
        ),
        "AT",
    );
    assert.equal("counter" in browser, false);
});

test("missing, ambiguous, and canvas clues fail before model dispatch", async () => {
    await assert.rejects(
        actions.getClueValue(99, "across"),
        /missing_or_ambiguous/,
    );
    await browser.page.evaluate(() => {
        const clue = document.querySelector(
            '[data-fixture-id="clue-1-across"]',
        );
        const duplicate = clue.cloneNode(true);
        duplicate.dataset.fixtureId = "duplicate";
        clue.after(duplicate);
    });
    await assert.rejects(
        actions.getClueValue(1, "across"),
        /missing_or_ambiguous/,
    );
    await browser.page.evaluate(() => {
        document.querySelector("main").innerHTML =
            '<canvas width="180" height="180"></canvas>';
    });
    await assert.rejects(
        actions.enterText("cat", 1, "across"),
        /missing_or_ambiguous/,
    );
    assert.equal(calls, 0);
});

test("stale clue selection fails; a new public call reobserves", async () => {
    const normal = offlineClient(matcher);
    const stale = createCrosswordActions({
        ...browser,
        client: {
            async decide(...args) {
                const response = await normal.decide(...args);
                await browser.page.evaluate(() => {
                    document.querySelector(
                        '[data-fixture-id="clue-1-across"]',
                    ).textContent = "1. New clue";
                });
                return response;
            },
        },
    });
    await assert.rejects(stale.getClueValue(1, "across"), /stale_target/);
    assert.equal(await actions.getClueValue(1, "across"), "1. New clue");
});

test("wrong-direction and no-fit choices never click or type", async () => {
    for (const client of [
        offlineClient(
            (evidence) =>
                evidence.number === "1" && evidence.direction === "down",
        ),
        offlineClient(() => false),
    ]) {
        const guarded = createCrosswordActions({ ...browser, client });
        await assert.rejects(
            guarded.enterText("cat", 1, "across"),
            /no_fit_or_wrong_clue/,
        );
    }
    assert.equal(
        await browser.page.evaluate(() =>
            [...document.querySelectorAll("[data-cell]")].every(
                (cell) => !cell.value,
            ),
        ),
        true,
    );
});

test("conflicting crossing letters and wrong grid focus fail closed", async () => {
    await browser.page.evaluate(() => {
        document.querySelector('[data-cell="0"]').value = "X";
    });
    await assert.rejects(
        actions.enterText("cat", 1, "across"),
        /crossing_conflict/,
    );
    const page = browser.page;
    await page.evaluate(() => {
        document.querySelector('[data-cell="0"]').value = "";
        const trap = document.createElement("input");
        trap.id = "trap";
        document.body.append(trap);
        document.querySelector('[data-fixture-id="clue-1-across"]').onclick =
            () => trap.focus();
    });
    await assert.rejects(
        actions.enterText("cat", 1, "across"),
        /wrong_grid_focus/,
    );
    assert.equal(await page.locator("#trap").inputValue(), "");
});

test("owned desktop/mobile Playwright screenshots show a usable grid", async () => {
    const page = browser.page;
    for (const [name, width, height] of [
        ["desktop", 1100, 800],
        ["mobile", 390, 844],
    ]) {
        await page.setViewportSize({ width, height });
        await page
            .getByRole("heading", { name: "Original Mini Crossword" })
            .waitFor();
        assert.equal(await page.locator("[data-cell]").count(), 9);
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
