import assert from "node:assert/strict";
import test from "node:test";
import {
    decisionObserve,
    makeSnapshot,
    selectCandidate,
    validateAction,
} from "./observer.mjs";

const action = {
    description: "Open drill",
    method: "click",
    arguments: [],
    selector: "[data-product='drill']",
};
const snapshot = () =>
    makeSnapshot([{ evidence: { text: "Open drill" }, action }], 1);
const answer = (choice, noul = 1) => ({
    answers: { target: { choice }, fit: { noul } },
});

test("only an issued ID can resolve a host Action", () => {
    const observed = snapshot();
    assert.equal(
        selectCandidate(
            observed,
            answer(observed.candidates[0].id),
            observed.token,
        ).action,
        action,
    );
    assert.throws(
        () => selectCandidate(observed, answer("#invented"), observed.token),
        /unknown_candidate/,
    );
    assert.throws(
        () =>
            selectCandidate(observed, answer(observed.candidates[0].id), "old"),
        /stale_snapshot/,
    );
});

test("no-fit and uncertain fit never execute", () => {
    const observed = snapshot();
    assert.equal(
        selectCandidate(observed, answer("no_fit"), observed.token),
        undefined,
    );
    assert.equal(
        selectCandidate(
            observed,
            answer(observed.candidates[0].id, 0.79),
            observed.token,
        ),
        undefined,
    );
    assert.throws(
        () => selectCandidate(observed, answer("no_fit", NaN), observed.token),
        /invalid_fit/,
    );
});

test("host methods and string arguments are bounded", () => {
    validateAction(action);
    for (const invalid of [
        { ...action, method: "evaluate" },
        { ...action, arguments: ["injected"] },
        { ...action, method: "fill", arguments: [42] },
        { ...action, method: "press", arguments: ["Control+L"] },
    ])
        assert.throws(() => validateAction(invalid), /invalid|disallowed/);
});

test("decision receives evidence and IDs, not executable selectors", async () => {
    const observed = snapshot();
    const result = await decisionObserve(
        observed,
        {
            async decide(state, questions) {
                assert.equal(
                    JSON.stringify(state).includes(action.selector),
                    false,
                );
                assert.ok(questions.target.criteria.no_fit);
                assert.ok(
                    questions.fit.instructions.endsWith(
                        JSON.stringify(
                            observed.candidates.map(({ id, evidence }) => ({
                                id,
                                evidence,
                            })),
                        ),
                    ),
                );
                assert.equal(
                    questions.fit.instructions.includes(action.selector),
                    false,
                );
                assert.match(
                    questions.fit.instructions,
                    /wording need not be identical/,
                );
                return answer(observed.candidates[0].id);
            },
        },
        "Open the drill",
    );
    assert.equal(result.candidate.action, action);
});

test("empty observations never invoke the model", async () => {
    assert.equal(
        await decisionObserve(
            makeSnapshot([], 0),
            {
                decide() {
                    throw new Error("must not call");
                },
            },
            "missing",
        ),
        undefined,
    );
});
