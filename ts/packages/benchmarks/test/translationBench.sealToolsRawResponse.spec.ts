// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PythonNumber } from "../src/translationBench/public_datasets/pythonLiteral.js";
import {
    parseSealToolsRawResponse,
    restoreSealToolsRawActions,
} from "../src/translationBench/public_datasets/Seal-Tools/sealToolsRawResponse.js";

describe("Seal-Tools raw responses", () => {
    it("restores the newest complete action list", () => {
        const complete = JSON.stringify({
            actionName: "multiple",
            parameters: {
                requests: [
                    { actionName: "search", parameters: { limit: 1e2 } },
                    { action: { actionName: "open" } },
                ],
            },
        }).replace("100", "1e2");
        const parsed = parseSealToolsRawResponse("use [option] " + complete);

        expect(parsed.actions[0]?.parameters).toEqual({
            limit: new PythonNumber("1e2"),
        });
        expect(
            restoreSealToolsRawActions(
                {
                    chosenActions: [
                        { actionName: "open" },
                        { actionName: "search" },
                    ],
                },
                ['[{"actionName":"search"}]', complete],
            ),
        ).toHaveLength(2);
    });
});
