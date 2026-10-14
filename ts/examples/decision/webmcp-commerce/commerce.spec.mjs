// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { DEPARTMENTS, DIETARY, PRODUCTS } from "./catalog.mjs";
import {
    bindAnswers,
    buildQuestions,
    dietaryQuestion,
    productGrounded,
} from "./bind.mjs";
import { execute, mutationCount, resetMutations } from "./execute.mjs";
import { cases } from "./fixtures.mjs";
import { validatePlan } from "./planner.mjs";
import { run as runDecision } from "./main.mjs";
import { run as runHybrid } from "./hybrid.mjs";
import { runDecisionCase, runHybridCase, runGenOnly } from "./runner.mjs";
import { startServer } from "./server.mjs";
import {
    eligibleTools,
    literalSpans,
    MAX_SPAN_CHARS,
    refusePublicExecution,
    validateArguments,
    validateSpan,
} from "./schema.mjs";

test("host policy removes cart and checkout before decision questions", () => {
    const names = eligibleTools().map((tool) => tool.name);
    assert.deepEqual(names, ["search_products", "get_product_details"]);
    const questions = buildQuestions("Any gluten-free rolls in bakery?");
    assert.deepEqual(Object.keys(questions.questions.tool.criteria), [
        "search_products",
        "get_product_details",
        "no_fit",
    ]);
    assert.equal("add_to_cart" in questions.questions.tool.criteria, false);
    assert.equal("checkout" in questions.questions.tool.criteria, false);
});

test("owned dataset covers no-fit, missing args, dietary combo, invalids, injection, and declined writes", () => {
    assert.equal(cases.length, 20);
    const kinds = new Set(cases.map((item) => item.kind));
    for (const kind of [
        "in-scope",
        "no-fit",
        "missing-args",
        "invalid",
        "declined",
        "hybrid-plan",
    ]) {
        assert.equal(kinds.has(kind), true, kind);
    }
    assert.equal(DEPARTMENTS.length, 4);
    assert.equal(DIETARY.length, 3);
    assert.equal(PRODUCTS.length, 8);
});

test("free-text candidates are exact original indexes and reject tampering or length", () => {
    const request = "Any gluten-free rolls in bakery?";
    const spans = literalSpans(request);
    const rolls = spans.find((span) => span.text === "rolls");
    assert.ok(rolls);
    assert.equal(request.slice(rolls.start, rolls.end), "rolls");
    assert.equal(
        validateSpan(request, { ...rolls, text: "roll" }, spans).reason,
        "span_text_not_exact",
    );
    assert.equal(
        validateSpan(
            request,
            { id: "span:1:4", text: request.slice(1, 4), start: 1, end: 4 },
            spans,
        ).reason,
        "span_not_in_candidates",
    );
    const long = "a".repeat(MAX_SPAN_CHARS + 1);
    assert.equal(
        validateSpan(
            long,
            { id: "span:0:49", text: long, start: 0, end: long.length },
            [
                {
                    id: "span:0:49",
                    text: long,
                    start: 0,
                    end: long.length,
                },
            ],
        ).reason,
        "span_index_or_length",
    );
});

test("search binding keeps enum order, exact spans, and rejects unknown fields", () => {
    const item = cases.find((entry) => entry.id === "dietary-combo");
    const built = buildQuestions(item.request);
    const span = built.spans.find((entry) => entry.text === "snacks");
    const bound = bindAnswers(
        item.request,
        searchAnswer(item, span.id),
        built.spans,
    );
    assert.equal(bound.status, "bound");
    assert.deepEqual(bound.arguments.dietary, ["gluten-free", "vegan"]);
    assert.equal(bound.arguments.query.text, "snacks");
    assert.equal(
        item.request.slice(
            bound.arguments.query.start,
            bound.arguments.query.end,
        ),
        "snacks",
    );
    const tool = eligibleTools()[0];
    assert.equal(
        validateArguments(
            tool,
            { ...bound.arguments, store: "Harbor Foods" },
            item.request,
            built.spans,
        ).reason,
        "unknown_field",
    );
    assert.equal(
        validateArguments(
            tool,
            { dietary: ["vegan", "vegan"] },
            item.request,
            built.spans,
        ).reason,
        "duplicate_enum",
    );
    assert.equal(
        validateArguments(
            tool,
            { department: "weapons" },
            item.request,
            built.spans,
        ).reason,
        "unknown_enum",
    );
});

test("missing and ungrounded product arguments hand off without execution", () => {
    const missing = cases.find((entry) => entry.id === "missing-details");
    const built = buildQuestions(missing.request);
    const handoff = bindAnswers(
        missing.request,
        {
            answers: {
                fit: noul(0.9),
                tool: choice("get_product_details"),
                product_id: choice("none"),
            },
        },
        built.spans,
    );
    assert.equal(handoff.status, "manual_handoff");
    assert.deepEqual(handoff.missing, ["product_id"]);
    const unknown = cases.find((entry) => entry.id === "unknown-product");
    const unknownSpans = literalSpans(unknown.request);
    assert.equal(
        productGrounded(unknown.request, "peanut-butter", unknownSpans),
        false,
    );
    resetMutations();
    const result = execute("get_product_details", {}, missing.request);
    assert.equal(result.executed, false);
    assert.equal(mutationCount(), 0);
});

test("state-changing and injection requests never call a model or mutate", async () => {
    resetMutations();
    let calls = 0;
    const client = {
        decide() {
            calls += 1;
            throw new Error("should-not-run");
        },
    };
    for (const id of ["injection", "add-cart", "checkout", "login"]) {
        const result = await runDecisionCase(
            cases.find((entry) => entry.id === id),
            client,
        );
        assert.equal(result.status, "declined", id);
        assert.equal(result.executed, false, id);
    }
    assert.equal(calls, 0);
    assert.equal(
        execute("add_to_cart", { product_id: "oat-milk" }, "").status,
        "declined",
    );
    assert.equal(execute("checkout", {}, "").status, "declined");
    assert.equal(mutationCount(), 0);
});

test("decision failure does not retry or execute", async () => {
    let calls = 0;
    const result = await runDecisionCase(cases[0], {
        decide() {
            calls += 1;
            throw new Error("transport");
        },
    });
    assert.equal(calls, 1);
    assert.equal(result.status, "failed_closed");
    assert.equal(result.executed, false);
    assert.equal(result.mutated, false);
});

test("hybrid plan budget and invented entities do not execute", async () => {
    const item = cases.find((entry) => entry.id === "hybrid-plan");
    let decisions = 0;
    const over = await runHybridCase(item, {
        generativeClient: {
            async generate() {
                return {
                    value: {
                        subtasks: [
                            { intent: "Find food" },
                            { intent: "Show details" },
                            { intent: "Find food" },
                            { intent: "Show details" },
                        ],
                    },
                };
            },
        },
        decisionClient: {
            decide() {
                decisions += 1;
            },
        },
    });
    assert.equal(over.reason, "plan_budget_exceeded");
    assert.equal(decisions, 0);
    assert.equal(over.executed, false);
    const invented = validatePlan(item.request, {
        subtasks: [{ intent: "Search Harbor Foods for unicorn cheese" }],
    });
    assert.equal(invented.reason, "intent_introduces_entity");
    const extra = validatePlan(item.request, {
        subtasks: [{ intent: "Find food" }],
        product_id: "millet-roll",
    });
    assert.equal(extra.reason, "forbidden_field");
});

test("hybrid preserves original spans and does not execute a planner rewrite", async () => {
    const item = cases.find((entry) => entry.id === "hybrid-plan");
    const spans = literalSpans(item.request);
    const millet = spans.find((span) => span.text === "Millet Roll");
    assert.equal(item.request.slice(millet.start, millet.end), "Millet Roll");
    const seen = [];
    const result = await runHybridCase(item, {
        generativeClient: {
            async generate() {
                return {
                    value: {
                        subtasks: item.subtasks.map((intent) => ({ intent })),
                    },
                };
            },
        },
        decisionClient: {
            async decide(state) {
                seen.push(state.originalInput);
                assert.equal(state.subtaskIntent.includes("Unicorn"), false);
                if (state.subtaskIntent.startsWith("Show")) {
                    return {
                        answers: {
                            fit: noul(0.9),
                            tool: choice("get_product_details"),
                            product_id: choice("millet-roll"),
                        },
                    };
                }
                const query = spans.find((span) => span.text === "food");
                return searchAnswer(
                    {
                        department: "bakery",
                        dietary: ["gluten-free"],
                        queryText: "food",
                    },
                    query.id,
                );
            },
        },
    });
    assert.equal(result.status, "ok");
    assert.equal(seen.length, 2);
    assert.equal(new Set(seen).size, 1);
    assert.equal(result.steps[1].product.name, "Millet Roll");
    assert.equal(result.mutated, false);
    assert.equal(
        result.steps[0].arguments.query.text === "Unicorn Cheese",
        false,
    );
});

test("hybrid reports completed reads when a later step abstains", async () => {
    const item = cases.find((entry) => entry.id === "hybrid-plan");
    let calls = 0;
    const result = await runHybridCase(item, {
        generativeClient: {
            async generate() {
                return {
                    value: {
                        subtasks: item.subtasks.map((intent) => ({ intent })),
                    },
                };
            },
        },
        decisionClient: {
            async decide() {
                calls++;
                return calls === 1
                    ? searchAnswer(
                          {
                              department: "bakery",
                              dietary: ["gluten-free"],
                              queryText: "food",
                          },
                          literalSpans(item.request).find(
                              (span) => span.text === "food",
                          ).id,
                      )
                    : {
                          answers: {
                              fit: noul(0.1),
                              tool: choice("get_product_details"),
                              product_id: choice("millet-roll"),
                          },
                      };
            },
        },
    });
    assert.equal(result.status, "no_fit");
    assert.equal(result.executed, true);
    assert.equal(result.steps.length, 1);
    assert.equal(result.decisionCalls, 2);
    assert.equal(result.mutated, false);
});

test("gen-only comparison cannot execute a denied tool", async () => {
    resetMutations();
    const result = await runGenOnly(cases[0], {
        async generate() {
            return {
                value: {
                    proposedTool: "add_to_cart",
                    note: "comparison only",
                },
            };
        },
    });
    assert.equal(result.executed, false);
    assert.equal(result.eligible, false);
    assert.equal(mutationCount(), 0);
});

test("offline entrypoints make no model calls and do not require the generative client", async () => {
    const silent = () => {};
    const decision = await runDecision([], { write: silent });
    const hybrid = await runHybrid([], { write: silent });
    assert.equal(decision.modelCalls, 0);
    assert.equal(decision.mode, "offline");
    assert.equal(hybrid.modelCalls, 0);
    assert.equal(hybrid.mode, "offline");
    assert.equal(
        hybrid.results.find((result) => result.id === "gf-bakery").status,
        "blocked",
    );
    assert.equal(
        decision.results.find((result) => result.id === "add-cart").status,
        "declined",
    );
});

test("localhost server serves owned files only", async () => {
    const server = await startServer();
    try {
        const page = await fetch(`${server.url}/`);
        const image = await fetch(`${server.url}/images/apple.svg`);
        const blocked = await fetch(`${server.url}/../decision.mjs`);
        const posted = await fetch(`${server.url}/`, { method: "POST" });
        assert.equal(page.status, 200);
        assert.match(
            page.headers.get("content-security-policy"),
            /connect-src 'none'/,
        );
        assert.equal(image.status, 200);
        assert.equal(blocked.status, 404);
        assert.equal(posted.status, 404);
    } finally {
        await server.close();
    }
});

test("public shopping site execution is refused", () => {
    assert.throws(
        () =>
            refusePublicExecution(
                "https://shopping-webmcp-demo.netlify.app/store/greenleaf",
            ),
        /public_site_execution_refused/,
    );
});

function noul(value) {
    return { type: "noul", noul: value };
}

function choice(value) {
    return { type: "choice", choice: value };
}

function searchAnswer(item, spanId) {
    const answers = {
        fit: noul(0.92),
        tool: choice("search_products"),
        department: choice(item.department ?? "none"),
        organic_specified: noul(item.organic === undefined ? 0.1 : 0.95),
        organic: noul(item.organic ? 0.95 : 0.05),
        query_span: choice(spanId),
        product_id: choice("none"),
    };
    for (const tag of DIETARY) {
        answers[dietaryQuestion(tag)] = noul(
            item.dietary?.includes(tag) ? 0.95 : 0.05,
        );
    }
    return { answers };
}
