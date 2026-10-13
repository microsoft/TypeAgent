import assert from "node:assert/strict";
import test from "node:test";
import { createCrosswordActions, validateRequest } from "./crossword.mjs";
import { options } from "../web-shopping/run.mjs";

test("the public action surface is exactly the existing two actions", () => {
    assert.deepEqual(Object.keys(createCrosswordActions({})), [
        "getClueValue",
        "enterText",
    ]);
});

test("clue requests are numbered and direction-bounded", () => {
    validateRequest(1, "across");
    validateRequest(1, "down");
    for (const [number, direction] of [
        [0, "across"],
        [1.1, "across"],
        ["1", "across"],
        [1, "diagonal"],
    ])
        assert.throws(
            () => validateRequest(number, direction),
            /invalid_clue_request/,
        );
});

test("answers are supplied, never generated or silently stripped", async () => {
    const actions = createCrosswordActions({});
    for (const answer of [undefined, "", "C-A-T", "cat!", 123])
        await assert.rejects(
            actions.enterText(answer, 1, "across"),
            /unsupported_answer/,
        );
});

test("runner bounds live smoke and defaults offline", () => {
    assert.equal(options([]).live, false);
    assert.equal(options([]).limit, 2);
    assert.throws(() => options(["--limit", "3"]), /limit/);
    assert.throws(() => options(["--live", "--dry-run"]), /mutually/);
});
