import assert from "node:assert/strict";
import test from "node:test";
import { buildConfig } from "@typeagent/config";
import { buildCopilotDecisionRequest } from "../decision.mjs";
import { cases } from "./fixtures.mjs";
import {
    DECISION_MODEL,
    VERDICTS,
    assertFixtures,
    checkExplicit,
    choiceVerdict,
    combinePredicate,
    decisionState,
    run,
    verificationQuestions,
} from "./verify.mjs";

test("verification fixtures stay inside the exact verdict set", () => {
    assertFixtures(cases);
    assert.equal(cases.length, 24);
    assert.equal(new Set(cases.map((item) => item.id)).size, 24);
    for (const item of cases) {
        assert.equal(
            checkExplicit(item.page, item.expectation).verdict,
            item.expected,
        );
    }
    const byKind = Object.groupBy(cases, (item) => item.expected);
    assert.ok(byKind.matched.length >= 5);
    assert.ok(byKind["not-matched"].length >= 5);
    assert.ok(byKind.insufficient.length >= 5);
});

test("false completion is not abstention and raw HTML is not evidence", () => {
    const negated = cases.find((item) => item.id === "negated-confirmation");
    const conflict = cases.find((item) => item.id === "conflicting-status");
    const injected = cases.find((item) => item.id === "injected-confirm");
    assert.equal(
        checkExplicit(negated.page, negated.expectation).verdict,
        "not-matched",
    );
    assert.equal(
        checkExplicit(conflict.page, conflict.expectation).verdict,
        "insufficient",
    );
    assert.notEqual(
        checkExplicit(negated.page, negated.expectation).verdict,
        checkExplicit(conflict.page, conflict.expectation).verdict,
    );
    assert.equal(
        checkExplicit(injected.page, injected.expectation).verdict,
        "not-matched",
    );
    const ignored = checkExplicit(
        {
            html: "<p>confirmed shipped saved authenticated</p>",
            nodes: [],
        },
        { requires: [{ name: "status", equals: "confirmed" }] },
    );
    assert.equal(ignored.verdict, "insufficient");
    assert.throws(
        () =>
            checkExplicit(
                { nodes: [{ name: "status", trusted: true }] },
                { requires: [{}] },
            ),
        /name and equals/,
    );
});

test("choice criteria are exact members and predicate sufficiency can abstain", () => {
    const questions = verificationQuestions();
    const request = buildCopilotDecisionRequest(
        DECISION_MODEL,
        decisionState(cases[0]),
        questions,
    );
    assert.equal(request.model, DECISION_MODEL);
    assert.deepEqual(
        request.questions
            .find((question) => question.name === "verdict")
            .choices.map((choice) => choice.value),
        VERDICTS,
    );
    assert.equal(JSON.stringify(request).includes("html"), false);
    assert.equal(
        combinePredicate({
            evidence_sufficient: { type: "noul", noul: 0.2 },
            expectation_matched: { type: "noul", noul: 0.99 },
        }).verdict,
        "insufficient",
    );
    assert.equal(
        combinePredicate({
            evidence_sufficient: { type: "noul", noul: 0.9 },
            expectation_matched: { type: "noul", noul: 0.1 },
        }).verdict,
        "not-matched",
    );
    assert.throws(
        () => choiceVerdict({ verdict: { type: "choice", choice: "maybe" } }),
        /exactly matched/,
    );
});

test("offline dry-run does not call the decision endpoint", async (context) => {
    context.mock.method(globalThis, "fetch", () => {
        throw new Error("network should not be called");
    });
    const lines = [];
    context.mock.method(process.stdout, "write", (line) => {
        lines.push(line);
        return true;
    });
    const code = await run([]);
    assert.equal(code, 0);
    assert.equal(lines.length, 24);
    const row = JSON.parse(lines[0]);
    assert.equal(row.mode, "offline");
    assert.equal(row.generativeBaseline, "not-run");
    assert.equal(row.variants.deterministic.actual, row.expected);
    assert.equal(row.variants.predicate.actual, null);
    assert.equal(row.variants.predicate.fallback, "offline-dry-run");
    assert.equal(row.variants.choice.fallback, "offline-dry-run");
    assert.equal(JSON.stringify(row).includes("Bearer"), false);
});

test("mocked live call records native probabilities and rejects unknown choices", async (context) => {
    let requests = 0;
    context.mock.method(globalThis, "fetch", async (_url, init) => {
        requests += 1;
        const body = JSON.parse(init.body);
        assert.equal(body.model, DECISION_MODEL);
        assert.equal(init.headers.Authorization, "Bearer test-token");
        if (requests === 1) {
            return new Response(
                JSON.stringify({
                    answers: [
                        {
                            name: "evidence_sufficient",
                            type: "predicate",
                            probability: 0.91,
                        },
                        {
                            name: "expectation_matched",
                            type: "predicate",
                            probability: 0.84,
                        },
                        {
                            name: "verdict",
                            type: "choice",
                            choice: "matched",
                            confidence: 0.73,
                            probabilities: [
                                { value: "matched", probability: 0.73 },
                                { value: "not-matched", probability: 0.2 },
                                { value: "insufficient", probability: 0.07 },
                            ],
                        },
                    ],
                }),
                { status: 200 },
            );
        }
        return new Response(
            JSON.stringify({
                answers: [
                    {
                        name: "evidence_sufficient",
                        type: "predicate",
                        probability: 0.5,
                    },
                    {
                        name: "expectation_matched",
                        type: "predicate",
                        probability: 0.5,
                    },
                    {
                        name: "verdict",
                        type: "choice",
                        choice: "complete",
                        probabilities: [{ value: "complete", probability: 1 }],
                    },
                ],
            }),
            { status: 200 },
        );
    });
    const provider = {
        async getEndpoint() {
            return {
                baseUrl: "https://example.githubcopilot.com",
                headers: { Authorization: "Bearer test-token" },
            };
        },
    };
    const lines = [];
    context.mock.method(process.stdout, "write", (line) => {
        lines.push(line);
        return true;
    });
    const live = await run(["--live", "--limit", "1"], {
        config: buildConfig({}),
        endpointProvider: provider,
    });
    assert.equal(live, 0);
    assert.equal(requests, 1);
    const row = JSON.parse(lines.at(-1));
    assert.equal(row.mode, "live");
    assert.equal(row.variants.predicate.actual, "matched");
    assert.equal(
        row.variants.predicate.probabilities.evidence_sufficient,
        0.91,
    );
    assert.equal(row.variants.choice.actual, "matched");
    assert.equal(row.variants.choice.nativeConfidence, 0.73);
    assert.deepEqual(row.variants.choice.probabilities, {
        matched: 0.73,
        "not-matched": 0.2,
        insufficient: 0.07,
    });
    assert.equal(row.generativeBaseline, "not-run");

    const failed = await run(["--live", "--limit", "1"], {
        config: buildConfig({}),
        endpointProvider: provider,
    });
    assert.equal(failed, 1);
    const failure = JSON.parse(lines.at(-1));
    assert.equal(failure.variants.choice.actual, null);
    assert.match(
        failure.variants.choice.failure,
        /Unsupported choice|Invalid answer type|probability/,
    );
    assert.equal(failure.variants.deterministic.actual, "matched");
});
