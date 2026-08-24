// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { toDroidCallBenchmarkCase } from "../src/translationBench/public_datasets/DroidCall/droidCallBenchmark.js";

describe("DroidCall benchmark conversion", () => {
    it("preserves dependencies and optional parameter scoring", () => {
        const row = toDroidCallBenchmarkCase(
            {
                query: "Find Ada and send a message",
                answers: [
                    { id: 0, name: "find", arguments: { name: "Ada" } },
                    { id: 1, name: "send", arguments: { to: "#0" } },
                ],
                tools: [
                    {
                        name: "find",
                        description: "Find a contact",
                        arguments: {
                            name: { type: "str", required: false },
                        },
                    },
                    {
                        name: "send",
                        description: "Send a message",
                        arguments: { to: { type: "str", required: true } },
                    },
                ],
            },
            "test",
            4,
        );

        expect(row?.order).toBe("strict");
        expect(row?.parameterScore).toEqual([
            { defaultMode: "exact", fields: {} },
            { defaultMode: "exact", fields: {} },
        ]);
        expect(row?.lineage.rowId).toBe("droidcall-test-4");
    });
});
