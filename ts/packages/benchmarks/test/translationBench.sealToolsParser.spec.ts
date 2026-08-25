// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    parseSealToolsRow,
    toSealToolsFunctionTool,
} from "../src/translationBench/public_datasets/Seal-Tools/getDataset.js";
import { scoreSealTools } from "../src/translationBench/public_datasets/Seal-Tools/sealToolsScorer.js";

describe("Seal-Tools source parser", () => {
    it("preserves quoted instructions and numeric parameter lexemes", () => {
        const parsed = parseSealToolsRow({
            id: "easy-1",
            domain: "people",
            conversations: [
                {
                    from: "human",
                    value:
                        "api_list = [{'api_name': 'search', 'parameters': {'age': {'type': 'int'}}, 'required': ['age']}]\n" +
                        'task_instruction = "Find age "44" now"\nOutput:',
                },
                {
                    from: "gpt",
                    value: "[{'api': 'search', 'parameters': {'age': 44}}]",
                },
            ],
        });

        expect(parsed?.utterance).toBe('Find age "44" now');
        expect(toSealToolsFunctionTool(parsed!.tools[0]!)).toMatchObject({
            function: { parameters: { required: ["age"] } },
        });
        expect(
            scoreSealTools(
                [
                    {
                        gold: parsed!.calls,
                        predictions: [
                            { actionName: "SEARCH", parameters: { age: 44 } },
                        ],
                    },
                ],
                { ignoreStringCase: true },
            ).counts.correctParameters,
        ).toBe(1);
    });
});
