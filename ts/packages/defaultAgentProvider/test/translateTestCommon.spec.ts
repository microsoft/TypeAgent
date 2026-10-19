// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { validateExpectedAction } from "./translateTestCommon.js";

const originalRequest = "Tell me what images are in our chat history.";
const expected = [
    {
        action: {
            schemaName: "dispatcher.lookup",
            actionName: "lookupAndAnswerConversation",
            parameters: { originalRequest },
        },
        partial: true,
        parameterPatterns: {
            question:
                "^(?:what|which) (?:images|pictures|photos)\\b.*\\b(?:our|the) chat history\\?$",
        },
    },
];

function action(question?: string | number) {
    return {
        schemaName: "dispatcher.lookup",
        actionName: "lookupAndAnswerConversation",
        parameters: { originalRequest, question },
    };
}

describe("translation fixture parameter patterns", () => {
    test.each([
        "What images are in our chat history?",
        "What images have appeared in our chat history?",
        "What images have been shared or discussed in our chat history?",
        "Which photos are present in the chat history?",
    ])("accepts a paraphrased image-history question: %s", (question) => {
        expect(() =>
            validateExpectedAction(expected, action(question)),
        ).not.toThrow();
    });

    test.each([
        undefined,
        42,
        "What videos are in our chat history?",
        "What images are on the internet?",
        "Search for pictures of mountains.",
    ])("rejects an absent or unrelated question: %s", (question) => {
        expect(() =>
            validateExpectedAction(expected, action(question)),
        ).toThrow();
    });

    test("still checks the action route and verbatim original request", () => {
        const translated = action("What images are in our chat history?");
        expect(() =>
            validateExpectedAction(expected, {
                ...translated,
                actionName: "showImageFile",
            }),
        ).toThrow();
        expect(() =>
            validateExpectedAction(expected, {
                ...translated,
                parameters: {
                    ...translated.parameters,
                    originalRequest: "Find pictures on the internet.",
                },
            }),
        ).toThrow();
    });

    test("reports invalid fixture patterns", () => {
        expect(() =>
            validateExpectedAction(
                [{ ...expected[0], parameterPatterns: { question: "[" } }],
                action("What images are in our chat history?"),
            ),
        ).toThrow(SyntaxError);
    });
});
