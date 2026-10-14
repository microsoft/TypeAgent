import test from "node:test";
import assert from "node:assert/strict";
import { prepareEntry, verifyEntry } from "./crossword.mjs";
import { createCrosswordActions, observeExolve } from "./crossword.mjs";
import { startCrosswordFixture } from "./fixture.mjs";
import { openBrowser } from "../web-shopping/browser.mjs";
import { offlineClient } from "../web-shopping/run.mjs";
import { options, scenarios } from "./run.mjs";
import { puzzleText } from "./puzzle.mjs";

const client = offlineClient(
    (evidence, request) =>
        evidence.number === request.match(/clue (\d+)/)?.[1] &&
        evidence.direction === request.match(/\b(across|down)\b/)?.[1],
);

test("recording scenarios are bounded and grid is genuinely 15x15 without solutions", () => {
    const grid = puzzleText
        .split("exolve-grid:\n")[1]
        .split("exolve-across:")[0]
        .trim()
        .split("\n");
    assert.equal(grid.length, 15);
    assert.ok(grid.every((row) => /^[0.]{15}$/.test(row)));
    assert.equal(Object.keys(scenarios).length, 4);
    assert.ok(Object.values(scenarios).every((steps) => steps.length <= 2));
    assert.equal(options(["--scenario", "read", "--dry-run"]).scenario, "read");
    assert.throws(() => options(["--scenario", "unknown"]), /invalid_scenario/);
    assert.throws(() => options(["--demo"]), /record_directory/);
});

test("supplied entry preserves compatible crossings without solving", () => {
    const before = { "0,0": "", "0,1": "R", "0,2": "", "1,1": "A" };
    const light = ["0,0", "0,1", "0,2"];
    const normalized = prepareEntry("art", before, light);
    assert.equal(normalized, "ART");
    assert.deepEqual(
        verifyEntry(
            before,
            { ...before, "0,0": "A", "0,2": "T" },
            light,
            normalized,
        ),
        { normalized: "ART", readback: "ART", crossingsIntact: true },
    );
    assert.throws(
        () => prepareEntry("act", before, light),
        /crossing_conflict/,
    );
    assert.throws(() => prepareEntry("arts", before, light), /answer_length/);
    assert.throws(
        () => prepareEntry("a-r-t", before, light),
        /unsupported_answer/,
    );
    assert.throws(
        () => prepareEntry("art", before, ["0,0", "0,0", "0,2"]),
        /grid_mapping/,
    );
    assert.throws(
        () => verifyEntry(before, { ...before, "1,1": "X" }, light, normalized),
        /readback/,
    );
});

test("real 15x15 renderer: both directions, crossing guard, freshness and responsive layout", async () => {
    const fixture = await startCrosswordFixture();
    let browser;
    try {
        browser = await openBrowser();
        await browser.page.goto(fixture.url);
        const actions = createCrosswordActions({ ...browser, client });
        assert.deepEqual(Object.keys(actions), ["getClueValue", "enterText"]);
        const snapshot = await observeExolve(browser.page);
        assert.equal(snapshot.candidates.length, 36);
        assert.equal(
            await actions.getClueValue(1, "across"),
            "Device producing a concentrated beam of light (5)",
        );
        assert.equal(
            (await actions.enterText("laser", 1, "across")).readback,
            "LASER",
        );
        assert.equal(
            (await actions.enterText("later", 1, "down")).readback,
            "LATER",
        );
        await assert.rejects(
            actions.enterText("water", 1, "down"),
            /crossing_conflict/,
        );
        await assert.rejects(
            actions.enterText("lasers", 1, "across"),
            /answer_length/,
        );
        await assert.rejects(
            actions.getClueValue(99, "down"),
            /missing_or_ambiguous/,
        );
        const stale = createCrosswordActions({
            ...browser,
            client: {
                async decide(state) {
                    await browser.page.evaluate(() => {
                        document.querySelector(".xlv-clue-text").textContent =
                            "Changed clue";
                    });
                    return client.decide(state);
                },
            },
        });
        await assert.rejects(stale.getClueValue(1, "across"), /stale_target/);
        for (const width of [1100, 390]) {
            await browser.page.setViewportSize({ width, height: 800 });
            assert.ok((await browser.page.screenshot()).length > 10000);
            assert.equal(
                await browser.page.evaluate(
                    () => document.documentElement.scrollWidth <= innerWidth,
                ),
                true,
            );
        }
    } finally {
        try {
            await browser?.close();
        } finally {
            await fixture.close();
        }
    }
});
