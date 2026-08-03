// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    extractDisplayText,
    parseTranslatedActions,
} from "../src/generatedAgentTranslator.js";

// The `@dispatcher translate` result and its progress/warning messages reach the
// capturing `ClientIO` NOT as bare display objects but wrapped in an
// `IAgentMessage` envelope: `{ message, requestId, source, sourceIcon }`, where
// `message` is either a bare string (the result block) or a
// `{ type, content, kind }` display object (status/warning). The capture must
// unwrap `.message` — a regression here silently yields an empty capture and the
// "Try it" proof resolves zero actions even though translation succeeded.
describe("generatedAgentTranslator display capture", () => {
    describe("extractDisplayText", () => {
        it("returns a bare string unchanged", () => {
            expect(extractDisplayText("hello")).toBe("hello");
        });

        it("unwraps an IAgentMessage envelope with a string message", () => {
            const envelope = {
                message: "the result block\n\nJSON:\n[]",
                requestId: { requestId: "abc" },
                source: "dispatcher",
                sourceIcon: "🤖",
            };
            expect(extractDisplayText(envelope)).toBe(
                "the result block\n\nJSON:\n[]",
            );
        });

        it("unwraps an envelope whose message is a { type, content, kind } object", () => {
            const envelope = {
                message: {
                    type: "text",
                    content: "[🔎 agent] Translating 'x'",
                    kind: "status",
                },
                requestId: { requestId: "abc" },
                source: "dispatcher",
            };
            expect(extractDisplayText(envelope)).toBe(
                "[🔎 agent] Translating 'x'",
            );
        });

        it("falls back to a bare { content } object", () => {
            expect(extractDisplayText({ content: "plain content" })).toBe(
                "plain content",
            );
        });

        it("joins string[] content", () => {
            expect(extractDisplayText({ content: ["a", "b", "c"] })).toBe(
                "a\nb\nc",
            );
        });

        it("returns empty string for non-object / null / unshaped input", () => {
            expect(extractDisplayText(null)).toBe("");
            expect(extractDisplayText(undefined)).toBe("");
            expect(extractDisplayText(42)).toBe("");
            expect(extractDisplayText({ requestId: "x" })).toBe("");
        });
    });

    describe("capture + parse pipeline (the real Try-it flow)", () => {
        // Reproduces exactly what the dispatcher passes to appendDisplay for a
        // successful translate: a status envelope followed by the result-block
        // envelope carrying the `JSON:` payload under `.message`.
        function capturePipeline(
            messages: unknown[],
        ): ReturnType<typeof parseTranslatedActions> {
            let captured = "";
            const capture = (msg: unknown) => {
                const text = extractDisplayText(msg);
                if (text) {
                    captured += `${text}\n`;
                }
            };
            for (const m of messages) {
                capture(m);
            }
            return parseTranslatedActions(captured);
        }

        it("resolves the action from the real envelope shape", () => {
            const status = {
                message: {
                    type: "text",
                    content:
                        "[🔎 demo-countries] Translating 'Show me all the countries in Asia.'",
                    kind: "status",
                },
                requestId: { requestId: "r1" },
                source: "dispatcher",
            };
            const block = {
                message:
                    'Show me all the countries in Asia. => demo-countries.filterByRegion({"region":"Asia"}) [2.5s](Tokens: 1 + 2 = 3)\n\nJSON:\n' +
                    JSON.stringify(
                        [
                            {
                                action: {
                                    schemaName: "demo-countries",
                                    actionName: "filterByRegion",
                                    parameters: { region: "Asia" },
                                },
                            },
                        ],
                        undefined,
                        2,
                    ),
                requestId: { requestId: "r1" },
                source: "dispatcher",
                sourceIcon: "🤖",
            };

            const actions = capturePipeline([status, block]);
            expect(actions).toEqual([
                { schemaName: "demo-countries", actionName: "filterByRegion" },
            ]);
        });

        it("resolves nothing when the envelope is not unwrapped (documents the failure mode)", () => {
            // If a future refactor drops the `.message` unwrap, extractDisplayText
            // returns "" for these envelopes and the proof silently fails.
            const block = {
                message:
                    'x => a.b({}) \n\nJSON:\n[{"action":{"schemaName":"a","actionName":"b"}}]',
                requestId: { requestId: "r1" },
            };
            // Sanity: with unwrapping in place, this DOES resolve.
            expect(capturePipeline([block])).toEqual([
                { schemaName: "a", actionName: "b" },
            ]);
        });
    });
});
