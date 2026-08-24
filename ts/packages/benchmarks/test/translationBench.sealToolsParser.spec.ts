// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    parseSealToolsRow,
    toSealToolsFunctionTool,
} from "../src/translationBench/public_datasets/Seal-Tools/getDataset.js";

describe("Seal-Tools source parser", () => {
    it("parses a source conversation and tool schema", () => {
        const parsed = parseSealToolsRow({
            id: "easy-1",
            domain: "travel",
            conversations: [
                {
                    from: "human",
                    value:
                        "api_list = [{'api_name': 'search', 'api_description': 'Find trips', 'parameters': {'city': {'type': 'str'}}, 'required': ['city']}]\n" +
                        "task_instruction = 'Find trips to Paris'\nOutput:",
                },
                {
                    from: "gpt",
                    value: "[{'api': 'search', 'parameters': {'city': 'Paris'}, 'responses': ['API_call_0']}]",
                },
            ],
        });

        expect(parsed?.utterance).toBe("Find trips to Paris");
        expect(parsed?.calls[0]).toEqual({
            api: "search",
            parameters: { city: "Paris" },
            responses: ["API_call_0"],
        });
        expect(toSealToolsFunctionTool(parsed!.tools[0]!)).toMatchObject({
            function: { parameters: { required: ["city"] } },
        });
    });
});
