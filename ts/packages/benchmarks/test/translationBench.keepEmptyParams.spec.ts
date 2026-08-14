// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";

import { stripEmptyGoldPlaceholdersFromCandidate } from "../src/translationBench/synthesizer/generationCandidate.js";

describe("keep empty parameters after gold placeholder strip", () => {
    it("keeps parameters:{} when nested empties strip to nothing", () => {
        const stripped = stripEmptyGoldPlaceholdersFromCandidate({
            seed: {
                utterance: "get the current selection",
                expectedActions: [
                    {
                        schemaName: "code",
                        actionName: "getSelection",
                        parameters: {
                            unused: "",
                            nested: { flag: null },
                        },
                    },
                ],
                order: "strict",
            },
            genCases: [
                {
                    id: "pos-1",
                    role: "positive",
                    utterance: "what text is selected",
                    expectedActions: [
                        {
                            schemaName: "code",
                            actionName: "getSelection",
                            parameters: { unused: "   " },
                        },
                    ],
                    order: "strict",
                    dimensions: { variation: "paraphrase" },
                },
                {
                    id: "neg-1",
                    role: "negative",
                    utterance: "leave my editor alone",
                    expectedActions: [],
                    order: "strict",
                    dimensions: { negativeKind: "pure_refusal" },
                },
            ],
        });

        expect(stripped.seed.expectedActions[0]).toEqual({
            schemaName: "code",
            actionName: "getSelection",
            parameters: {},
        });
        expect(stripped.genCases[0]!.expectedActions[0]).toEqual({
            schemaName: "code",
            actionName: "getSelection",
            parameters: {},
        });
        // Negatives are not rewritten by the strip helper.
        expect(stripped.genCases[1]!.expectedActions).toEqual([]);
    });

    it("does not invent parameters when gold omitted the key", () => {
        const stripped = stripEmptyGoldPlaceholdersFromCandidate({
            seed: {
                utterance: "list themes",
                expectedActions: [
                    {
                        schemaName: "desktop",
                        actionName: "ListThemes",
                    },
                ],
                order: "strict",
            },
            genCases: [
                {
                    id: "pos-1",
                    role: "positive",
                    utterance: "show desktop themes",
                    expectedActions: [
                        {
                            schemaName: "desktop",
                            actionName: "ListThemes",
                        },
                    ],
                    order: "strict",
                    dimensions: { variation: "paraphrase" },
                },
                {
                    id: "neg-1",
                    role: "negative",
                    utterance: "do not list themes",
                    expectedActions: [],
                    order: "strict",
                    dimensions: { negativeKind: "pure_refusal" },
                },
            ],
        });

        expect(stripped.seed.expectedActions[0]).toEqual({
            schemaName: "desktop",
            actionName: "ListThemes",
        });
        expect(stripped.seed.expectedActions[0]).not.toHaveProperty(
            "parameters",
        );
    });

    it("still strips empty nested fields while keeping non-empty siblings", () => {
        const stripped = stripEmptyGoldPlaceholdersFromCandidate({
            seed: {
                utterance: "open apple.com",
                expectedActions: [
                    {
                        schemaName: "browser",
                        actionName: "openWebPage",
                        parameters: {
                            site: "apple.com",
                            tab: "",
                            extras: {},
                        },
                    },
                ],
                order: "strict",
            },
            genCases: [
                {
                    id: "pos-1",
                    role: "positive",
                    utterance: "navigate to apple.com",
                    expectedActions: [
                        {
                            schemaName: "browser",
                            actionName: "openWebPage",
                            parameters: {
                                site: "apple.com",
                                tab: null,
                            },
                        },
                    ],
                    order: "strict",
                    dimensions: { variation: "paraphrase" },
                },
                {
                    id: "neg-1",
                    role: "negative",
                    utterance: "leave browser alone",
                    expectedActions: [],
                    order: "strict",
                    dimensions: { negativeKind: "pure_refusal" },
                },
            ],
        });

        expect(stripped.seed.expectedActions[0]!.parameters).toEqual({
            site: "apple.com",
        });
        expect(stripped.genCases[0]!.expectedActions[0]!.parameters).toEqual({
            site: "apple.com",
        });
    });
});
