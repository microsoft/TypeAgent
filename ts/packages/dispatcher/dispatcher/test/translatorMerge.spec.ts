// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mergeTranslatorEvidence } from "../src/neighborhoods/translatorMerge.js";
import type { Neighborhood } from "../src/neighborhoods/types.js";

describe("mergeTranslatorEvidence (forward-compat stub)", () => {
    const sample: Neighborhood[] = [
        {
            id: "a-b",
            kind: "cross-schema",
            members: [
                { schemaName: "a", actionName: "x" },
                { schemaName: "b", actionName: "y" },
            ],
            evidence: {
                misrouteCount: 5,
                misrouteEdges: [{ from: "a.x", to: "b.y", count: 5 }],
            },
            sources: ["corpus"],
        },
    ];

    it("returns the input unchanged when no records are supplied", () => {
        const out = mergeTranslatorEvidence(sample);
        expect(out).toBe(sample);
    });

    it("returns the input unchanged when records is an empty array", () => {
        const out = mergeTranslatorEvidence(sample, { records: [] });
        expect(out).toBe(sample);
    });
});
