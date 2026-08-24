// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    classifyDroidCalls,
    parseDroidCallCode,
} from "../src/translationBench/public_datasets/DroidCall/droidCallParser.js";

describe("DroidCall source parser", () => {
    it("parses nested calls and result references", () => {
        const calls = parseDroidCallCode(
            "result0 = find(name='Ada')\n" +
                "result1 = send(to=result0, tags=['work', 'vip'])",
        );

        expect(calls).toEqual([
            { id: 0, name: "find", arguments: { name: "Ada" } },
            {
                id: 1,
                name: "send",
                arguments: { to: "#0", tags: ["work", "vip"] },
            },
        ]);
        expect(classifyDroidCalls(calls)).toBe("multiCallNested");
    });

    it("does not treat ordinary hash text as a result reference", () => {
        const calls = parseDroidCallCode(
            "result0 = find(note='ticket #1')\nresult1 = archive()",
        );

        expect(classifyDroidCalls(calls)).toBe("multiCallWithoutNested");
    });
});
