import assert from "node:assert/strict";
import test from "node:test";
import { makeSnapshot } from "../web-shopping/observer.mjs";
import { candidateSchema, generateTarget } from "./selection.mjs";
import { options, runDemo, safeFailure } from "./run.mjs";

function snapshot() {
    return makeSnapshot(
        [
            {
                evidence: { text: "Cordless only" },
                action: {
                    selector: "#host",
                    method: "click",
                    arguments: [],
                    description: "filter",
                },
            },
        ],
        0,
    );
}

test("generation sees only observed IDs and evidence; resolves the exact host object", async () => {
    const observed = snapshot();
    const result = await generateTarget(
        observed,
        {
            async generate(task, evidence, schema) {
                assert.equal(task, "filter");
                assert.deepEqual(
                    evidence,
                    observed.candidates.map(({ id, evidence }) => ({
                        id,
                        evidence,
                    })),
                );
                assert.equal(JSON.stringify(evidence).includes("#host"), false);
                assert.deepEqual(schema, candidateSchema(observed));
                return { value: { choice: evidence[0].id } };
            },
        },
        "filter",
    );
    assert.equal(result.candidate, observed.candidates[0]);
});

test("no_fit abstains; unknown IDs, refusals, missing fields and action injection fail", async () => {
    const observed = snapshot();
    for (const value of [
        null,
        [],
        {},
        { refusal: "refused" },
        { choice: 1 },
        { choice: "invented" },
        { choice: observed.candidates[0].id, selector: "body" },
    ])
        await assert.rejects(
            generateTarget(
                observed,
                { generate: async () => ({ value }) },
                "filter",
            ),
            /invalid_generated_choice|unknown_candidate/,
        );
    assert.equal(
        (
            await generateTarget(
                observed,
                { generate: async () => ({ value: { choice: "no_fit" } }) },
                "filter",
            )
        ).candidate,
        undefined,
    );
    assert.equal(
        (
            await generateTarget(
                { candidates: [] },
                {
                    generate: () =>
                        assert.fail("empty candidates must not call model"),
                },
                "filter",
            )
        ).candidate,
        undefined,
    );
});

test("invalid host actions still fail even for a known generated ID", async () => {
    const observed = snapshot();
    observed.candidates[0].action.method = "purchase";
    await assert.rejects(
        generateTarget(
            observed,
            {
                generate: async () => ({
                    value: { choice: observed.candidates[0].id },
                }),
            },
            "filter",
        ),
        /invalid_host_action/,
    );
});

test("CLI defaults offline, caps work and dry-run makes zero calls", async () => {
    assert.equal(options([]).live, false);
    for (const limit of ["0", "3", "1.2"])
        assert.throws(() => options(["--limit", limit]), /invalid_limit/);
    assert.throws(() => options(["--live", "--dry-run"]), /conflicting_modes/);
    const report = await runDemo(options(["--dry-run"]));
    assert.equal(report.selectorCalls, 0);
    assert.equal(report.cases.length, 0);
    assert.equal(
        safeFailure(new Error("private body")),
        "demo_execution_failed",
    );
});
