// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    isNonEvalTranslationBenchAction,
    isUnknownActionSchemaMatchError,
    scoreTranslationBench,
    scoreTranslationBenchTranslationOutcome,
    toScoredTranslationBenchActions,
    TRANSLATION_BENCH_NON_EVAL_ACTION_IDS,
} from "../src/translationBench/runner/runner.js";
import { HARDCODED_NON_EVAL_ACTION_IDS } from "../src/translationBench/synthesizer/eligibleActions.js";
import type { AppAction } from "@typeagent/agent-sdk";

describe("translationBench runner scoring fairness (E + C)", () => {
    it("recognizes dispatcher unknown schema-match errors", () => {
        expect(
            isUnknownActionSchemaMatchError(
                new Error(
                    "Internal Error: Unable to match schema name for action unknown",
                ),
            ),
        ).toBe(true);
        expect(
            isUnknownActionSchemaMatchError(
                "Internal Error: Unable to match schema name for action 'unknown'",
            ),
        ).toBe(true);
        expect(
            isUnknownActionSchemaMatchError(
                new Error("JSON validation failed: Missing required property"),
            ),
        ).toBe(false);
    });

    it("treats unknown schema-match throw as zero-action PASS on empty gold", () => {
        const { chosenActions, score, error, rawChosenActions } =
            scoreTranslationBenchTranslationOutcome([], "any", {
                ok: false,
                error: new Error(
                    "Internal Error: Unable to match schema name for action unknown",
                ),
            });
        expect(error).toBeUndefined();
        expect(chosenActions).toEqual([]);
        expect(rawChosenActions).toEqual([
            { schemaName: "", actionName: "unknown" },
        ]);
        expect(score.passed).toBe(true);
        expect(score.exactPassed).toBe(true);
        expect(score.schemaValid).toBe(true);
        expect(score.isNegative).toBe(true);
        expect(score.firedOnNegative).toBe(false);
        expect(score.diagnostics.invalidJsonOrTranslationFailure).toBe(0);
    });

    it("unknown schema-match throw still FAILs when gold expects actions", () => {
        const { score, error } = scoreTranslationBenchTranslationOutcome(
            [
                {
                    schemaName: "browser",
                    actionName: "goBack",
                    parameters: {},
                },
            ],
            "any",
            {
                ok: false,
                error: new Error(
                    "Internal Error: Unable to match schema name for action unknown",
                ),
            },
        );
        expect(error).toBeUndefined(); // abstention scored, not harness error
        expect(score.passed).toBe(false);
        expect(score.exactPassed).toBe(false);
        expect(score.schemaValid).toBe(true);
        expect(score.isNegative).toBe(false);
        expect(score.chosenCount).toBe(0);
        expect(score.expectedCount).toBe(1);
    });

    it("runner non-eval IDs are the shared generator set (no drift)", () => {
        expect([...TRANSLATION_BENCH_NON_EVAL_ACTION_IDS].sort()).toEqual(
            [...HARDCODED_NON_EVAL_ACTION_IDS].sort(),
        );
        expect(TRANSLATION_BENCH_NON_EVAL_ACTION_IDS).toBe(
            HARDCODED_NON_EVAL_ACTION_IDS,
        );
    });

    it("success-path unknown action is filtered; sibling tool fire remains", () => {
        const r = toScoredTranslationBenchActions([
            {
                schemaName: "browser",
                actionName: "closeWebPage",
                parameters: {},
            } as AppAction,
            { schemaName: "dispatcher", actionName: "unknown" } as AppAction,
        ]);
        expect(r.abstentionCount).toBe(1);
        const score = scoreTranslationBench(
            [],
            r.chosenActions,
            "any",
            r.abstentionCount,
            { schemaValid: true },
        );
        expect(r.chosenActions).toHaveLength(1);
        expect(r.chosenActions[0]?.actionName).toBe("closeWebPage");
        expect(score.passed).toBe(false);
        expect(score.firedOnNegative).toBe(true);
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

    it("filters unknown abstention from successful translations", () => {
        const actions = [{ actionName: "unknown" } as AppAction];
        const { chosenActions, abstentionCount, rawChosenActions } =
            toScoredTranslationBenchActions(actions);
        expect(abstentionCount).toBe(1);
        expect(chosenActions).toEqual([]);
        expect(rawChosenActions[0]?.actionName).toBe("unknown");
        const score = scoreTranslationBench([], chosenActions, "any", 1, {
            schemaValid: true,
        });
        expect(score.passed).toBe(true);
        expect(score.firedOnNegative).toBe(false);
    });

    it("does not count chat.generateResponse / utility.claudeTask as fires", () => {
        expect(
            TRANSLATION_BENCH_NON_EVAL_ACTION_IDS.has("chat.generateResponse"),
        ).toBe(true);
        expect(
            TRANSLATION_BENCH_NON_EVAL_ACTION_IDS.has("utility.claudeTask"),
        ).toBe(true);
        expect(
            isNonEvalTranslationBenchAction({
                schemaName: "chat",
                actionName: "generateResponse",
            }),
        ).toBe(true);

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
        expect(chosenActions).toEqual([]);
        expect(score.passed).toBe(true);
        expect(score.firedOnNegative).toBe(false);
        expect(score.chosenCount).toBe(0);
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
});
