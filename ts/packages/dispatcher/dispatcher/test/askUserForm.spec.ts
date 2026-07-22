// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Unit tests for the reasoning `ask_user_form` helper: validating/normalizing
 * the LLM-authored form spec (buildReasoningForm), presenting it via the
 * blocking `askForm` interaction with a sequential `question` fallback
 * (presentReasoningForm), and formatting answers back for the model
 * (formatReasoningFormResponse).
 */

import type { QuestionForm, QuestionFormResponse } from "@typeagent/agent-sdk";
import type { ClientIO } from "@typeagent/dispatcher-types";
import {
    buildReasoningForm,
    formatReasoningFormResponse,
    presentReasoningForm,
} from "../src/reasoning/askUserForm.js";

function expectForm(
    result: { form: QuestionForm } | { error: string },
): QuestionForm {
    if ("error" in result) {
        throw new Error(`expected a form, got error: ${result.error}`);
    }
    return result.form;
}

describe("buildReasoningForm", () => {
    it("normalizes a mixed multi-question spec", () => {
        const form = expectForm(
            buildReasoningForm({
                message: "Pick a plan",
                questions: [
                    {
                        id: "size",
                        kind: "pick",
                        prompt: "Size?",
                        choices: ["S", "M", "L"],
                    },
                    {
                        id: "toppings",
                        kind: "multiChoice",
                        prompt: "Toppings?",
                        choices: ["Cheese", "Olives"],
                        allowFreeText: true,
                    },
                    { id: "confirm", kind: "yesNo", prompt: "Proceed?" },
                ],
                paged: true,
            }),
        );

        expect(form.message).toBe("Pick a plan");
        expect(form.paged).toBe(true);
        expect(form.fields).toHaveLength(3);
        expect(form.fields[0]).toMatchObject({
            id: "size",
            kind: "pick",
            choices: ["S", "M", "L"],
        });
        expect(form.fields[1]).toMatchObject({
            id: "toppings",
            kind: "multiChoice",
            allowFreeText: true,
        });
        expect(form.fields[2]).toMatchObject({ id: "confirm", kind: "yesNo" });
    });

    it("omits message/paged when not provided", () => {
        const form = expectForm(
            buildReasoningForm({
                questions: [{ id: "q", kind: "yesNo", prompt: "OK?" }],
            }),
        );
        expect("message" in form).toBe(false);
        expect("paged" in form).toBe(false);
    });

    it("auto-assigns ids when missing", () => {
        const form = expectForm(
            buildReasoningForm({
                questions: [
                    { kind: "yesNo", prompt: "A?" },
                    { kind: "yesNo", prompt: "B?" },
                ],
            }),
        );
        expect(form.fields.map((f) => f.id)).toEqual(["q1", "q2"]);
    });

    it("rejects an empty questions array", () => {
        const r = buildReasoningForm({ questions: [] });
        expect("error" in r && r.error).toMatch(/non-empty/);
    });

    it("rejects pick/multiChoice with fewer than two choices", () => {
        const r = buildReasoningForm({
            questions: [
                { id: "x", kind: "pick", prompt: "One?", choices: ["only"] },
            ],
        });
        expect("error" in r && r.error).toMatch(/at least 2/);
    });

    it("rejects an unknown kind", () => {
        const r = buildReasoningForm({
            questions: [{ id: "x", kind: "slider", prompt: "?" }],
        });
        expect("error" in r && r.error).toMatch(/unknown kind/);
    });

    it("rejects duplicate ids", () => {
        const r = buildReasoningForm({
            questions: [
                { id: "dup", kind: "yesNo", prompt: "A?" },
                { id: "dup", kind: "yesNo", prompt: "B?" },
            ],
        });
        expect("error" in r && r.error).toMatch(/Duplicate/);
    });

    it("rejects a missing prompt", () => {
        const r = buildReasoningForm({
            questions: [{ id: "x", kind: "yesNo" }],
        });
        expect("error" in r && r.error).toMatch(/missing a prompt/);
    });
});

describe("presentReasoningForm", () => {
    const form: QuestionForm = {
        fields: [
            { id: "size", kind: "pick", prompt: "Size?", choices: ["S", "M"] },
            {
                id: "extras",
                kind: "multiChoice",
                prompt: "Extras?",
                choices: ["A", "B"],
            },
            { id: "ok", kind: "yesNo", prompt: "OK?" },
        ],
    };

    it("uses askForm when the host supports it", async () => {
        const canned: QuestionFormResponse = {
            answers: {
                size: { kind: "pick", selected: 1 },
                extras: { kind: "multiChoice", selected: [0, 1] },
                ok: { kind: "yesNo", value: true },
            },
        };
        let seenSource: string | undefined;
        const clientIO = {
            askForm: async (_rid: unknown, _form: unknown, source: string) => {
                seenSource = source;
                return canned;
            },
            question: async () => {
                throw new Error("question should not be called");
            },
        } as unknown as ClientIO;

        const response = await presentReasoningForm(clientIO, undefined, form);
        expect(response).toBe(canned);
        expect(seenSource).toBe("reasoning");
    });

    it("falls back to sequential question() when askForm is absent", async () => {
        const asked: string[] = [];
        // Scripted answers per prompt: pick -> M (index 1), multiChoice -> A
        // (index 0, degraded to single-select), yesNo -> No (index 1).
        const byPrompt: Record<string, number> = {
            "Size?": 1,
            "Extras?": 0,
            "OK?": 1,
        };
        const clientIO = {
            question: async (
                _rid: unknown,
                message: string,
                choices: string[],
            ) => {
                asked.push(message);
                // yesNo fallback presents ["Yes","No"].
                expect(choices.length).toBeGreaterThanOrEqual(2);
                return byPrompt[message];
            },
        } as unknown as ClientIO;

        const response = await presentReasoningForm(clientIO, undefined, form);
        expect(asked).toEqual(["Size?", "Extras?", "OK?"]);
        expect(response.answers.size).toEqual({ kind: "pick", selected: 1 });
        expect(response.answers.extras).toEqual({
            kind: "multiChoice",
            selected: [0],
        });
        expect(response.answers.ok).toEqual({ kind: "yesNo", value: false });
    });
});

describe("formatReasoningFormResponse", () => {
    const form: QuestionForm = {
        fields: [
            { id: "size", kind: "pick", prompt: "Size?", choices: ["S", "M"] },
            {
                id: "extras",
                kind: "multiChoice",
                prompt: "Extras?",
                choices: ["A", "B"],
                allowFreeText: true,
            },
            { id: "ok", kind: "yesNo", prompt: "OK?" },
            {
                id: "note",
                kind: "pick",
                prompt: "Note?",
                choices: ["x", "y"],
                allowFreeText: true,
            },
        ],
    };

    it("renders one line per answer, including free text and multi-select", () => {
        const text = formatReasoningFormResponse(form, {
            answers: {
                size: { kind: "pick", selected: 1 },
                extras: {
                    kind: "multiChoice",
                    selected: [0],
                    text: "Extra sauce",
                },
                ok: { kind: "yesNo", value: true },
                note: { kind: "pick", selected: -1, text: "custom" },
            },
        });
        expect(text).toContain("- Size? => M");
        expect(text).toContain('- Extras? => A, "Extra sauce" (free text)');
        expect(text).toContain("- OK? => Yes");
        expect(text).toContain('- Note? => "custom" (free text)');
    });

    it("reports a dismissed form", () => {
        const text = formatReasoningFormResponse(form, {
            answers: {},
            cancelled: true,
        });
        expect(text).toMatch(/dismissed the form/);
    });
});
