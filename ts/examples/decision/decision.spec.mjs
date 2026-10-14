import assert from "node:assert/strict";
import test from "node:test";
import { buildConfig } from "@typeagent/config";
import {
    buildCopilotDecisionRequest,
    createCopilotDecisionClient,
    createDecisionClient,
    median,
    normalizeCopilotAnswers,
    validateAnswers,
} from "./decision.mjs";

test("uses the exact Copilot decisions model and refreshes rejected credentials", async (context) => {
    const questions = { flag: { type: "noul", instructions: "Is this true?" } };
    const config = buildConfig({});
    const refreshes = [];
    const provider = {
        async getEndpoint(force = false) {
            refreshes.push(force);
            return {
                baseUrl: "https://example.githubcopilot.com",
                headers: {
                    Authorization: force
                        ? "Bearer refreshed-test-token"
                        : "Bearer test-token",
                },
            };
        },
    };
    let requests = 0;
    context.mock.method(globalThis, "fetch", async (url, init) => {
        assert.equal(url, "https://example.githubcopilot.com/v1/decisions");
        assert.equal(init.method, "POST");
        assert.deepEqual(JSON.parse(init.body), {
            model: "gpt-6-luna-decisions",
            input: "Yes",
            questions: [
                {
                    type: "predicate",
                    name: "flag",
                    instructions: "Is this true?",
                },
            ],
        });
        requests++;
        if (requests === 1) return new Response(null, { status: 401 });
        assert.equal(init.headers.Authorization, "Bearer refreshed-test-token");
        return new Response(
            JSON.stringify({
                answers: [
                    { type: "predicate", name: "flag", probability: 0.9 },
                ],
            }),
            { status: 200 },
        );
    });
    const client = createCopilotDecisionClient(config, {}, provider);
    assert.equal(
        (await client.decide("Yes", questions)).answers.flag.noul,
        0.9,
    );
    assert.deepEqual(refreshes, [false, true]);
});

test("maps shared JSON input and all three question types to the documented schema", () => {
    const request = buildCopilotDecisionRequest(
        "gpt-6-luna-decisions",
        { message: "Checkout is down" },
        {
            flag: { type: "noul", instructions: "Is this severe?" },
            team: {
                type: "choice",
                instructions: "Which team?",
                criteria: { billing: "Invoices", technical: "Bugs" },
            },
            severity: {
                type: "score",
                instructions: "How severe?",
                criteria: ["Minor", "Critical"],
            },
        },
    );
    assert.equal(request.input, '{"message":"Checkout is down"}');
    assert.deepEqual(request.questions, [
        { name: "flag", instructions: "Is this severe?", type: "predicate" },
        {
            name: "team",
            instructions: "Which team?",
            type: "choice",
            choices: [
                { value: "billing", description: "Invoices" },
                { value: "technical", description: "Bugs" },
            ],
        },
        {
            name: "severity",
            instructions: "How severe?",
            type: "score",
            levels: [
                { label: "Minor", description: "Minor" },
                { label: "Critical", description: "Critical" },
            ],
        },
    ]);
});

test("normalizes native Copilot answers while preserving confidence and usage", () => {
    const questions = {
        flag: { type: "noul" },
        team: {
            type: "choice",
            criteria: { billing: "Invoices", technical: "Bugs" },
        },
        severity: { type: "score", criteria: ["Minor", "Critical"] },
    };
    const payload = {
        usage: { input_tokens: 100 },
        answers: [
            {
                name: "team",
                type: "choice",
                choice: "technical",
                confidence: 0.8,
                probabilities: [
                    { value: "billing", probability: 0.1 },
                    { value: "technical", probability: 0.9 },
                ],
            },
            { name: "flag", type: "predicate", probability: 0.9 },
            {
                name: "severity",
                type: "score",
                score: 0.8,
                probabilities: [
                    { value: 0, probability: 0.2 },
                    { value: 1, probability: 0.8 },
                ],
            },
        ],
    };
    const result = normalizeCopilotAnswers(payload, questions);
    assert.equal(result.answers.flag.noul, 0.9);
    assert.equal(result.answers.team.confidence, 0.8);
    assert.deepEqual(result.answers.severity.probabilities, { 0: 0.2, 1: 0.8 });
    assert.equal(result.nativeAnswers, payload.answers);
    assert.equal(result.usage, payload.usage);
});

test("rejects refusals, duplicate names, and invalid native distributions", () => {
    const questions = { flag: { type: "noul" } };
    assert.throws(
        () => normalizeCopilotAnswers({}, questions),
        /answers array/,
    );
    assert.throws(
        () =>
            normalizeCopilotAnswers(
                { answers: [{ name: "flag", type: "refusal" }] },
                questions,
            ),
        /refused question/,
    );
    assert.throws(
        () =>
            normalizeCopilotAnswers(
                {
                    answers: [
                        { name: "other", type: "predicate", probability: 0.5 },
                    ],
                },
                questions,
            ),
        /answer names/,
    );
    assert.throws(
        () =>
            normalizeCopilotAnswers(
                {
                    answers: [
                        { name: "flag", type: "predicate", probability: 0.5 },
                        { name: "flag", type: "predicate", probability: 0.5 },
                    ],
                },
                questions,
            ),
        /answer names/,
    );
    assert.throws(
        () =>
            normalizeCopilotAnswers(
                {
                    answers: [
                        { name: "flag", type: "predicate", probability: 2 },
                    ],
                },
                questions,
            ),
        /numerical answer/,
    );
    assert.throws(
        () =>
            normalizeCopilotAnswers(
                {
                    answers: [
                        {
                            name: "team",
                            type: "choice",
                            choice: "billing",
                            probabilities: [
                                { value: "billing", probability: 0.5 },
                                { value: "billing", probability: 0.5 },
                            ],
                        },
                    ],
                },
                {
                    team: {
                        type: "choice",
                        criteria: { billing: "Invoices", technical: "Bugs" },
                    },
                },
            ),
        /probability distribution/,
    );
});

test("accepts all three decision primitives", () => {
    const questions = {
        team: {
            type: "choice",
            criteria: { billing: "Invoices", technical: "Bugs" },
        },
        repeat: { type: "noul" },
        severity: { type: "score", criteria: ["Minor", "Major", "Critical"] },
    };
    const response = {
        answers: {
            team: {
                type: "choice",
                choice: "technical",
                probabilities: { billing: 0.1, technical: 0.9 },
            },
            repeat: { type: "noul", noul: 0.9 },
            severity: {
                type: "score",
                score: 1.8,
                probabilities: { 0: 0, 1: 0.2, 2: 0.8 },
            },
        },
    };
    assert.equal(validateAnswers(response, questions), response);
});

test("rejects missing, mismatched, unknown and out-of-range answers", () => {
    assert.throws(() => validateAnswers({}, {}), /no answers/);
    assert.throws(
        () => validateAnswers({ answers: {} }, { flag: { type: "noul" } }),
        /answer type/,
    );
    assert.throws(
        () =>
            validateAnswers(
                { answers: { flag: { type: "choice", choice: "other" } } },
                { flag: { type: "choice", criteria: { known: "Known" } } },
            ),
        /Unsupported choice/,
    );
    for (const value of [-1, 2, NaN, "0.5"]) {
        assert.throws(
            () =>
                validateAnswers(
                    { answers: { flag: { type: "noul", noul: value } } },
                    { flag: { type: "noul" } },
                ),
            /numerical answer/,
        );
    }
});

test("does not silently fall back to a chat deployment", () => {
    assert.throws(
        () =>
            createDecisionClient(
                { azureOpenAI: { deployments: new Map() } },
                "missing",
                "deployment",
            ),
        /No deployment configured/,
    );
});

test("computes the median without mutating input", () => {
    const values = [30, 10, 20, 40];
    assert.equal(median(values), 25);
    assert.equal(median([30, 10, 20]), 20);
    assert.deepEqual(values, [30, 10, 20, 40]);
});

test("rejects incomplete and invalid probability distributions", () => {
    const questions = {
        team: {
            type: "choice",
            criteria: { billing: "Invoices", technical: "Bugs" },
        },
    };
    for (const probabilities of [
        undefined,
        { billing: 1 },
        { billing: 0.3, technical: 0.3 },
        { billing: -0.1, technical: 1.1 },
    ]) {
        assert.throws(
            () =>
                validateAnswers(
                    {
                        answers: {
                            team: {
                                type: "choice",
                                choice: "billing",
                                probabilities,
                            },
                        },
                    },
                    questions,
                ),
            /probability distribution/,
        );
    }
    assert.throws(
        () =>
            validateAnswers(
                { answers: { severity: { type: "score", score: 3 } } },
                { severity: { type: "score", criteria: ["Minor", "Major"] } },
            ),
        /numerical answer/,
    );
});

test("uses AI Client transport with the deployment name and API-key auth", async (context) => {
    const endpoint =
        "https://example-eastus.services.ai.azure.com/providers/microsoft/v1/systemone";
    const config = buildConfig({
        AZURE_OPENAI_ENDPOINT_DECISION_1_EASTUS: endpoint,
        AZURE_OPENAI_API_KEY: "test-key",
    });
    const questions = { flag: { type: "noul", instructions: "Is this true?" } };
    context.mock.method(globalThis, "fetch", async (url, init) => {
        assert.equal(url, endpoint);
        assert.equal(init.method, "POST");
        assert.equal(init.headers["api-key"], "test-key");
        assert.deepEqual(JSON.parse(init.body), {
            model: "actual-deployment",
            state: "Yes",
            questions,
        });
        return new Response(
            JSON.stringify({ answers: { flag: { type: "noul", noul: 0.9 } } }),
            { status: 200 },
        );
    });
    const client = createDecisionClient(
        config,
        "decision_1",
        "actual-deployment",
        "eastus",
    );
    assert.equal(
        (await client.decide("Yes", questions)).answers.flag.noul,
        0.9,
    );
    assert.throws(
        () =>
            createDecisionClient(
                config,
                "decision_1",
                "actual-deployment",
                "westus",
            ),
        /No endpoints match/,
    );
});

test("Azure Decision-1 preserves native question maps, structured state, and all three answers", async (context) => {
    const endpoint =
        "https://example-eastus.services.ai.azure.com/providers/microsoft/v1/systemone";
    const config = buildConfig({
        AZURE_OPENAI_ENDPOINT_DECISION_1_EASTUS: endpoint,
        AZURE_OPENAI_API_KEY: "test-key",
    });
    const state = { message: "Checkout failed again", contact_count: 3 };
    const questions = {
        team: {
            type: "choice",
            instructions: "Which team supports this task?",
            criteria: { billing: "Invoices", technical: "Bugs" },
        },
        repeat: {
            type: "noul",
            instructions: "Is this a repeat contact?",
            criteria: { true: "More than one contact", false: "First contact" },
        },
        severity: {
            type: "score",
            instructions: "How severe is this issue?",
            criteria: ["Minor", "Major", "Critical"],
        },
    };
    const response = {
        model: "microsoft-decision-1",
        usage: { input_tokens: 100, output_tokens: 10 },
        answers: {
            team: {
                type: "choice",
                choice: "technical",
                probabilities: { billing: 0.1, technical: 0.9 },
            },
            repeat: { type: "noul", noul: 0.9 },
            severity: {
                type: "score",
                score: 1.8,
                probabilities: { 0: 0, 1: 0.2, 2: 0.8 },
            },
        },
    };
    let requests = 0;
    context.mock.method(globalThis, "fetch", async (url, init) => {
        requests++;
        assert.equal(url, endpoint);
        assert.equal(init.headers["api-key"], "test-key");
        assert.deepEqual(JSON.parse(init.body), {
            model: "deployed-decision-instance",
            state,
            questions,
        });
        return new Response(JSON.stringify(response), { status: 200 });
    });
    const client = createDecisionClient(
        config,
        "decision_1",
        "deployed-decision-instance",
        "eastus",
    );
    assert.deepEqual(await client.decide(state, questions), response);
    assert.equal(requests, 1);
});
