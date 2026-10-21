import assert from "node:assert/strict";
import test from "node:test";
import { buildConfig } from "@typeagent/config";
import { buildCopilotDecisionRequest } from "../decision.mjs";
import { cases } from "./fixtures.mjs";
import {
    DECISION_MODEL,
    SCORE_LEVELS,
    assertFixtures,
    decisionState,
    metricFor,
    predictsNoneRelevant,
    rankByScores,
    retrievalQuestions,
    run,
} from "./rerank.mjs";

test("retrieval fixtures have frozen labels and exact orders", () => {
    assertFixtures(cases);
    assert.equal(cases.length, 24);
    assert.ok(cases.some((item) => item.kind === "none"));
    assert.ok(cases.some((item) => item.kind === "tie"));
    assert.ok(cases.some((item) => item.kind === "adversarial"));
    const buried = cases.find((item) => item.id === "reset-buried");
    const top = cases.find((item) => item.id === "reset-top");
    const none = cases.find((item) => item.id === "no-wifi");
    assert.ok(metricFor(buried.retrievalOrder, buried.passages).ndcg < 1);
    assert.equal(metricFor(top.retrievalOrder, top.passages).ndcg, 1);
    assert.equal(metricFor(none.retrievalOrder, none.passages).ndcg, 1);
    assert.equal(
        metricFor(none.retrievalOrder, none.passages).ndcgInformative,
        false,
    );
    assert.throws(
        () => metricFor(["missing"], buried.passages),
        /exact permutation/,
    );
});

test("tie-aware NDCG ignores equal grades and score ties keep fixture order", () => {
    const tie = cases.find((item) => item.id === "csv-tie");
    assert.equal(
        metricFor(["alpha", "beta", "photo"], tie.passages).ndcg,
        metricFor(["beta", "alpha", "photo"], tie.passages).ndcg,
    );
    assert.deepEqual(
        rankByScores(
            tie.passages,
            { alpha: 2, beta: 2, photo: 0 },
            { alpha: 0.4, beta: 0.4, photo: 0.1 },
            ["photo", "alpha", "beta"],
        ),
        ["alpha", "beta", "photo"],
    );
    assert.deepEqual(
        rankByScores(
            tie.passages,
            { alpha: 2, beta: 2, photo: 0 },
            { alpha: 0.2, beta: 0.8, photo: 0.1 },
            ["photo", "alpha", "beta"],
        ),
        ["beta", "alpha", "photo"],
    );
    assert.equal(
        predictsNoneRelevant({ alpha: 0, beta: 0 }, { alpha: 0.1, beta: 0.2 }),
        true,
    );
    assert.equal(
        predictsNoneRelevant({ alpha: 1, beta: 0 }, { alpha: 0.1, beta: 0.1 }),
        false,
    );
    assert.equal(
        decisionState(tie).passages.some((passage) => "relevance" in passage),
        false,
    );
});

test("decision score levels are exact and labels are not sent", () => {
    const item = cases[0];
    const request = buildCopilotDecisionRequest(
        DECISION_MODEL,
        decisionState(item),
        retrievalQuestions(item),
    );
    assert.equal(request.questions.length, item.passages.length * 2);
    for (const question of request.questions.filter(
        (entry) => entry.type === "score",
    )) {
        assert.deepEqual(
            question.levels.map((level) => level.label),
            SCORE_LEVELS,
        );
    }
    assert.equal(request.input.includes("relevance"), false);
});

test("offline dry-run scores fixture order only", async (context) => {
    context.mock.method(globalThis, "fetch", () => {
        throw new Error("network should not be called");
    });
    const lines = [];
    context.mock.method(process.stdout, "write", (line) => {
        lines.push(line);
        return true;
    });
    const code = await run(["--limit", "3"]);
    assert.equal(code, 0);
    assert.equal(lines.length, 3);
    const row = JSON.parse(lines[0]);
    assert.equal(row.embeddingReranker, "not-run");
    assert.equal(row.generativeJudge, "not-run");
    assert.equal(row.variants.decision.fallback, "offline-dry-run");
    assert.equal(row.variants.decision.actual, null);
    assert.equal(typeof row.variants.fixtureOrder.actual.ndcg, "number");
    assert.deepEqual(
        row.variants.fixtureOrder.actual.order,
        row.expected.retrievalOrder,
    );
});

test("mocked live ranking records probabilities and explicit score failures", async (context) => {
    let requests = 0;
    context.mock.method(globalThis, "fetch", async (_url, init) => {
        requests += 1;
        const body = JSON.parse(init.body);
        assert.equal(body.model, DECISION_MODEL);
        const answers = body.questions.map((question) => {
            if (question.type === "predicate") {
                return {
                    name: question.name,
                    type: "predicate",
                    probability: 0.1,
                };
            }
            const score = requests === 1 ? 0 : 5;
            return {
                name: question.name,
                type: "score",
                score,
                confidence: 0.66,
                probabilities: [
                    { value: 0, probability: 1 },
                    { value: 1, probability: 0 },
                    { value: 2, probability: 0 },
                ],
            };
        });
        return new Response(JSON.stringify({ answers }), { status: 200 });
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
    const row = JSON.parse(lines.at(-1));
    assert.equal(row.variants.decision.actual.predictedNoneRelevant, true);
    assert.equal(row.variants.decision.nativeConfidence.guide.score, 0.66);
    assert.equal(row.embeddingReranker, "not-run");
    const failed = await run(["--live", "--limit", "1"], {
        config: buildConfig({}),
        endpointProvider: provider,
    });
    assert.equal(failed, 1);
    const failure = JSON.parse(lines.at(-1));
    assert.equal(failure.variants.decision.actual, null);
    assert.match(failure.variants.decision.failure, /invalid_response/);
    assert.ok(failure.variants.fixtureOrder.actual.order.length > 0);
});
