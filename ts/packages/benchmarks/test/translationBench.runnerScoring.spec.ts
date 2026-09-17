// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    canonicalizeTranslationBenchAction,
    isNonEvalTranslationBenchAction,
    scoreTranslationBench,
    scoreTranslationBenchTranslationOutcome,
    TRANSLATION_BENCH_NON_EVAL_ACTION_IDS,
} from "../src/translationBench/runner/runner.js";
import { HARDCODED_NON_EVAL_ACTION_IDS } from "../src/translationBench/synthesizer/eligibleActions.js";
import type { AppAction } from "@typeagent/agent-sdk";

describe("translationBench runner scoring fairness (E + C)", () => {
    it("ignores object key order in exact parameter matching", () => {
        const score = scoreTranslationBench(
            [
                {
                    schemaName: "test",
                    actionName: "lookup",
                    parameters: {
                        outer: { alpha: 1, beta: 2 },
                        items: [{ first: "A", second: "B" }],
                    },
                },
            ],
            [
                {
                    schemaName: "test",
                    actionName: "lookup",
                    parameters: {
                        items: [{ second: "B", first: "A" }],
                        outer: { beta: 2, alpha: 1 },
                    },
                },
            ],
            "any",
        );
        expect(score.exactPassed).toBe(true);
    });

    it("runner non-eval IDs are the shared generator set (no drift)", () => {
        expect([...TRANSLATION_BENCH_NON_EVAL_ACTION_IDS].sort()).toEqual(
            [...HARDCODED_NON_EVAL_ACTION_IDS].sort(),
        );
        expect(TRANSLATION_BENCH_NON_EVAL_ACTION_IDS).toBe(
            HARDCODED_NON_EVAL_ACTION_IDS,
        );
    });

    it("still FAILs real translation errors on empty gold", () => {
        const { score, error } = scoreTranslationBenchTranslationOutcome(
            [],
            "any",
            {
                ok: false,
                error: new Error(
                    "JSON validation failed: Missing required property 'parameters.requests'",
                ),
            },
        );
        expect(error).toMatch(/JSON validation failed/);
        expect(score.passed).toBe(false);
        expect(score.schemaValid).toBe(false);
        // Missing-required is classified under missingRequiredParameter, not invalidJson.
        expect(score.diagnostics.missingRequiredParameter).toBe(1);
        expect(score.diagnostics.invalidJsonOrTranslationFailure).toBe(0);
    });

    it("counts chat.generateResponse as a fire on empty-gold (fairness contract)", () => {
        expect(
            TRANSLATION_BENCH_NON_EVAL_ACTION_IDS.has("chat.generateResponse"),
        ).toBe(true);
        expect(
            isNonEvalTranslationBenchAction({
                schemaName: "chat",
                actionName: "generateResponse",
            }),
        ).toBe(true);

        // Empty-gold must be zero-action under the full catalog — chat acks
        // are fires, matching generation pure_refusal fairness.
        const { chosenActions, score, error } =
            scoreTranslationBenchTranslationOutcome([], "any", {
                ok: true,
                actions: [
                    {
                        schemaName: "chat",
                        actionName: "generateResponse",
                        parameters: { text: "ok" },
                    } as AppAction,
                ],
            });
        expect(error).toBeUndefined();
        expect(chosenActions).toEqual([
            {
                schemaName: "chat",
                actionName: "generateResponse",
                parameters: { text: "ok" },
            },
        ]);
        expect(score.passed).toBe(false);
        expect(score.firedOnNegative).toBe(true);
        expect(score.chosenCount).toBe(1);
    });

    it("still filters chat.generateResponse as a non-eval sidecar on positives", () => {
        const gold = [
            {
                schemaName: "browser",
                actionName: "goBack",
                parameters: {},
            },
        ];
        const { chosenActions, score } =
            scoreTranslationBenchTranslationOutcome(gold, "any", {
                ok: true,
                actions: [
                    {
                        schemaName: "browser",
                        actionName: "goBack",
                        parameters: {},
                    } as AppAction,
                    {
                        schemaName: "chat",
                        actionName: "generateResponse",
                        parameters: { text: "ok" },
                    } as AppAction,
                ],
            });
        expect(chosenActions).toEqual([
            { schemaName: "browser", actionName: "goBack", parameters: {} },
        ]);
        expect(score.passed).toBe(true);
    });

    it("still counts real tool fires on empty gold as FAIL", () => {
        const { chosenActions, score } =
            scoreTranslationBenchTranslationOutcome([], "any", {
                ok: true,
                actions: [
                    {
                        schemaName: "browser",
                        actionName: "closeWebPage",
                        parameters: {},
                    } as AppAction,
                ],
            });
        expect(chosenActions).toHaveLength(1);
        expect(score.passed).toBe(false);
        expect(score.firedOnNegative).toBe(true);
    });

    it("keeps real actions when mixed with non-eval chat ack", () => {
        const { chosenActions, score } =
            scoreTranslationBenchTranslationOutcome(
                [
                    {
                        schemaName: "browser",
                        actionName: "goBack",
                        parameters: {},
                    },
                ],
                "any",
                {
                    ok: true,
                    actions: [
                        {
                            schemaName: "browser",
                            actionName: "goBack",
                            parameters: {},
                        } as AppAction,
                        {
                            schemaName: "chat",
                            actionName: "generateResponse",
                            parameters: { text: "done" },
                        } as AppAction,
                    ],
                },
            );
        expect(chosenActions.map((a) => a.actionName)).toEqual(["goBack"]);
        expect(score.passed).toBe(true);
    });

    it("canonicalizes registerPageDynamicAgent to detectPageActions+registerAgent", () => {
        const canonical = canonicalizeTranslationBenchAction({
            schemaName: "browser.actionDiscovery",
            actionName: "registerPageDynamicAgent",
            parameters: { agentName: "TechNewsNavigator" },
        });
        expect(canonical).toEqual({
            schemaName: "browser.actionDiscovery",
            actionName: "detectPageActions",
            parameters: {
                registerAgent: true,
                agentName: "TechNewsNavigator",
            },
        });
    });

    it("passes when gold is registerPageDynamicAgent and model emits detectPageActions+registerAgent:true", () => {
        // TechNewsNavigator-style case: gold omitted registerAgent:true;
        // all models chose the fuller detectPageActions form.
        const score = scoreTranslationBench(
            [
                {
                    schemaName: "browser.actionDiscovery",
                    actionName: "registerPageDynamicAgent",
                    parameters: { agentName: "TechNewsNavigator" },
                },
            ],
            [
                {
                    schemaName: "browser.actionDiscovery",
                    actionName: "detectPageActions",
                    parameters: {
                        registerAgent: true,
                        agentName: "TechNewsNavigator",
                    },
                },
            ],
            "any",
        );
        expect(score.passed).toBe(true);
        expect(score.paramMatches).toBe(1);
        expect(score.routed).toBe(1);
        expect(score.diagnostics.wrongRouteOrAction).toBe(0);
    });

    it("passes single-action gold when chosen also includes extras that cover the same intent", () => {
        // detectPageActions gold with registerAgent:true; models often split
        // into detectPageActions{} + registerPageDynamicAgent{agentName}.
        // Case order is often "strict" — still must find the match at index 1.
        const score = scoreTranslationBench(
            [
                {
                    schemaName: "browser.actionDiscovery",
                    actionName: "detectPageActions",
                    parameters: {
                        registerAgent: true,
                        agentName: "Product Page Scout",
                    },
                },
            ],
            [
                {
                    schemaName: "browser.actionDiscovery",
                    actionName: "detectPageActions",
                    parameters: {},
                },
                {
                    schemaName: "browser.actionDiscovery",
                    actionName: "registerPageDynamicAgent",
                    parameters: { agentName: "Product Page Scout" },
                },
            ],
            "strict",
        );
        expect(score.passed).toBe(true);
        expect(score.paramMatches).toBe(1);
        expect(score.chosenCount).toBe(2);
        expect(score.exactPassed).toBe(false); // length mismatch keeps exact strict
    });

    it("rejects unrelated extra actions for single-action gold", () => {
        const action = {
            schemaName: "sealtools_dev_easy_189",
            actionName: "getDanceIdentity",
            parameters: { dance_style: "vZ0xGOxdZcrz" },
        };
        const score = scoreTranslationBench(
            [action],
            [
                action,
                {
                    ...action,
                    parameters: { dance_style: "ko5sG2EdYQ" },
                },
            ],
            "any",
        );
        expect(score.passed).toBe(false);
    });

    it("still fails single-action gold when no chosen action matches params", () => {
        const score = scoreTranslationBench(
            [
                {
                    schemaName: "browser.actionDiscovery",
                    actionName: "detectPageActions",
                    parameters: {
                        registerAgent: true,
                        agentName: "TechNewsNavigator",
                    },
                },
            ],
            [
                {
                    schemaName: "browser.actionDiscovery",
                    actionName: "detectPageActions",
                    parameters: {},
                },
                {
                    schemaName: "browser",
                    actionName: "openWebPage",
                    parameters: { site: "news" },
                },
            ],
            "any",
        );
        expect(score.passed).toBe(false);
        expect(score.paramMatches).toBe(0);
    });
});
