// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    parseDroidCallRawResponse,
    restoreDroidCallRawActions,
} from "../src/translationBench/public_datasets/DroidCall/eval/droidCallRawActions.js";

it("restores the accepted DroidCall response", () => {
    const response =
        'metadata: {"actionName":"metadata"}\n{"actionName":"multiple","parameters":{"requests":[{"action":{"actionName":"findContact"},"resultEntityId":"contact","pendingResultEntityId":"contact"},{"action":{"actionName":"sendMessage","parameters":{"recipient":{"$result":"contact"}}}}]}}';
    const translation = {
        chosenActions: [
            { actionName: "pendingRequestAction" },
            { actionName: "sendMessage" },
        ],
    };
    expect(restoreDroidCallRawActions(translation, [response])).toHaveLength(2);
    expect(
        restoreDroidCallRawActions(translation, [response])?.[1],
    ).toMatchObject({
        parameters: { recipient: { $result: "contact" } },
    });

    const accepted = [
        { actionName: "findContact", parameters: { name: "Ada" } },
    ];
    const restored = restoreDroidCallRawActions(
        { chosenActions: [], rawChosenActions: accepted },
        [
            JSON.stringify(accepted[0]),
            '{"actionName":"findContact","parameters":{"name":"Grace"}}',
            "[".repeat(1_000_001),
        ],
    );
    expect(restored).toEqual(accepted);

    const deep = `[${"[".repeat(101)}null${"]".repeat(101)}]`;
    expect(() => parseDroidCallRawResponse(deep)).toThrow("maxDepth");
});
