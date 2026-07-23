// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ActionContext } from "../src/agentInterface.js";
import type {
    QuestionFormField,
    QuestionFormPickField,
    QuestionFormResponse,
} from "../src/action.js";
import { ChoiceManager } from "../src/helpers/choiceManager.js";
import {
    createQuestionFormResult,
    createSingleChoiceResult,
} from "../src/helpers/actionHelpers.js";

// The helpers only pass the ActionContext straight through to the callback, so
// a bare stub is enough for these unit tests.
const fakeContext = {} as ActionContext<unknown>;

describe("createQuestionFormResult", () => {
    it("emits a pendingChoice of type 'form' carrying message + fields", () => {
        const cm = new ChoiceManager();
        const fields: QuestionFormField[] = [
            {
                id: "color",
                kind: "pick",
                prompt: "Color?",
                choices: ["Red", "Blue"],
            },
            {
                id: "sizes",
                kind: "multiChoice",
                prompt: "Sizes?",
                choices: ["S", "M", "L"],
            },
            { id: "ok", kind: "yesNo", prompt: "Proceed?" },
        ];
        const result = createQuestionFormResult(
            cm,
            "Pick options",
            fields,
            async () => undefined,
        );

        const pc = result.pendingChoice;
        expect(pc).toBeDefined();
        expect(pc?.type).toBe("form");
        if (pc?.type === "form") {
            expect(pc.message).toBe("Pick options");
            expect(pc.fields).toEqual(fields);
            expect(typeof pc.choiceId).toBe("string");
        }
        // displayContent is the heading, rendered as the agent bubble text.
        expect(result.displayContent).toBe("Pick options");
    });

    it("routes the QuestionFormResponse to the registered callback", async () => {
        const cm = new ChoiceManager();
        let received: QuestionFormResponse | undefined;
        const result = createQuestionFormResult(
            cm,
            "Q",
            [{ id: "a", kind: "pick", prompt: "A?", choices: ["x", "y"] }],
            async (response) => {
                received = response;
                return undefined;
            },
        );

        const response: QuestionFormResponse = {
            answers: { a: { kind: "pick", selected: 1 } },
        };
        await cm.handleChoice(
            result.pendingChoice!.choiceId,
            response,
            fakeContext,
        );
        expect(received).toEqual(response);
    });

    it("uses displayHtml for displayContent when provided", () => {
        const cm = new ChoiceManager();
        const result = createQuestionFormResult(
            cm,
            "heading",
            [{ id: "a", kind: "yesNo", prompt: "A?" }],
            async () => undefined,
            { displayHtml: "<b>hi</b>" },
        );
        expect(result.displayContent).toEqual({
            type: "html",
            content: "<b>hi</b>",
        });
    });

    it("sets pendingChoice.paged when the paged option is passed", () => {
        const cm = new ChoiceManager();
        const fields: QuestionFormField[] = [
            { id: "a", kind: "yesNo", prompt: "A?" },
        ];
        const plain = createQuestionFormResult(
            cm,
            "Q",
            fields,
            async () => undefined,
        );
        // Omitted by default (exactOptionalPropertyTypes: absent, not undefined).
        expect(plain.pendingChoice && "paged" in plain.pendingChoice).toBe(
            false,
        );

        const paged = createQuestionFormResult(
            cm,
            "Q",
            fields,
            async () => undefined,
            { paged: true },
        );
        expect(
            paged.pendingChoice?.type === "form" && paged.pendingChoice.paged,
        ).toBe(true);
    });
});

describe("createSingleChoiceResult", () => {
    it("builds a one-field pick form that forwards options", () => {
        const cm = new ChoiceManager();
        const result = createSingleChoiceResult(
            cm,
            "Choose one",
            ["A", "B", "C"],
            async () => undefined,
            {
                defaultId: 1,
                allowFreeText: true,
                freeTextPlaceholder: "type...",
            },
        );

        const pc = result.pendingChoice!;
        expect(pc.type).toBe("form");
        if (pc.type === "form") {
            expect(pc.fields).toHaveLength(1);
            expect(pc.fields[0]).toEqual({
                id: "choice",
                kind: "pick",
                // Empty so the heading isn't duplicated by a per-field prompt.
                prompt: "",
                choices: ["A", "B", "C"],
                defaultId: 1,
                allowFreeText: true,
                freeTextPlaceholder: "type...",
            });
        }
    });

    it("omits optional field props when the caller doesn't set them", () => {
        const cm = new ChoiceManager();
        const result = createSingleChoiceResult(
            cm,
            "Choose",
            ["A", "B"],
            async () => undefined,
        );
        const pc = result.pendingChoice!;
        if (pc.type === "form") {
            const field = pc.fields[0] as QuestionFormPickField;
            // exactOptionalPropertyTypes: the keys must be absent, not undefined.
            expect("defaultId" in field).toBe(false);
            expect("allowFreeText" in field).toBe(false);
            expect("freeTextPlaceholder" in field).toBe(false);
        }
    });

    it("maps a selected index to the (selected, text) callback", async () => {
        const cm = new ChoiceManager();
        const calls: Array<{ selected: number; text: string | undefined }> = [];
        const result = createSingleChoiceResult(
            cm,
            "Choose",
            ["A", "B"],
            async (selected, text) => {
                calls.push({ selected, text });
                return undefined;
            },
        );
        const response: QuestionFormResponse = {
            answers: { choice: { kind: "pick", selected: 1 } },
        };
        await cm.handleChoice(
            result.pendingChoice!.choiceId,
            response,
            fakeContext,
        );
        expect(calls).toEqual([{ selected: 1, text: undefined }]);
    });

    it("maps a free-text answer to (-1, text)", async () => {
        const cm = new ChoiceManager();
        let got: { selected: number; text: string | undefined } | undefined;
        const result = createSingleChoiceResult(
            cm,
            "Choose",
            ["A"],
            async (selected, text) => {
                got = { selected, text };
                return undefined;
            },
            { allowFreeText: true },
        );
        const response: QuestionFormResponse = {
            answers: { choice: { kind: "pick", selected: -1, text: "custom" } },
        };
        await cm.handleChoice(
            result.pendingChoice!.choiceId,
            response,
            fakeContext,
        );
        expect(got).toEqual({ selected: -1, text: "custom" });
    });

    it("defaults to selected -1 when the field's answer is missing", async () => {
        const cm = new ChoiceManager();
        let got: { selected: number; text: string | undefined } | undefined;
        const result = createSingleChoiceResult(
            cm,
            "Choose",
            ["A"],
            async (selected, text) => {
                got = { selected, text };
                return undefined;
            },
        );
        await cm.handleChoice(
            result.pendingChoice!.choiceId,
            { answers: {} },
            fakeContext,
        );
        expect(got).toEqual({ selected: -1, text: undefined });
    });
});
