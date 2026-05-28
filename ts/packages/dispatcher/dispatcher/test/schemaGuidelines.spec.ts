// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { schemaGuidelines } from "../src/translation/schemaGuidelines.js";

describe("schemaGuidelines", () => {
    it("contains the load-bearing 'WORK WITH THE LLM'S INTENT' principle", () => {
        // The optimize loop's lever propose prompts rely on this clause to
        // bias toward widening over scolding. Surface-level snapshot —
        // text must be there verbatim.
        expect(schemaGuidelines).toContain(
            "WORK WITH THE LLM'S INTENT, NOT AGAINST IT",
        );
    });

    it("contains the COMMENT STRUCTURE RULES heading", () => {
        expect(schemaGuidelines).toContain("COMMENT STRUCTURE RULES");
    });

    it("contains the IDENTITY LINE rule", () => {
        expect(schemaGuidelines).toContain("THE IDENTITY LINE IS CLOSEST");
    });

    it("contains the CRITICAL CONSTRAINT FORMAT guidance with WRONG/RIGHT example", () => {
        expect(schemaGuidelines).toContain("CRITICAL CONSTRAINT FORMAT");
        expect(schemaGuidelines).toContain("WRONG:");
        expect(schemaGuidelines).toContain("RIGHT:");
    });

    it("contains the BEST PRACTICES section with the enum-like example", () => {
        expect(schemaGuidelines).toContain("BEST PRACTICES:");
        expect(schemaGuidelines).toContain("ChartDataLabelPosition");
    });

    it("includes the 'positive parameters channel priors' nuance — the anti-anti-example clause", () => {
        // This is the subtle but important framing for collision fixes:
        // anti-examples ("DO NOT use for") are a LAST RESORT. Levers
        // should read this and bias accordingly.
        expect(schemaGuidelines).toContain("Anti-examples are a last resort");
        expect(schemaGuidelines).toContain(
            "positive parameters channel priors",
        );
    });
});
