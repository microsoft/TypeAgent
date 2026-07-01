// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    RingBufferSignalSource,
    SignalConfig,
} from "../src/context/contextSelector/conversationSignal.js";

function source(config: Partial<SignalConfig> = {}) {
    const cfg: SignalConfig = { windowTurns: 20, decay: 0.9, ...config };
    return new RingBufferSignalSource(() => cfg);
}

describe("contextSelector/conversationSignal", () => {
    it("recency-decays tokens by turn age (design §14 Scenario 1)", () => {
        const s = source();
        // Recorded oldest -> newest; the newest prior turn is age 1.
        s.recordRequest("scroll to the last row"); // age 4
        s.recordRequest("open the excel spreadsheet"); // age 3
        s.recordRequest("which cell has that formula"); // age 2
        s.recordRequest("fix the spreadsheet formula"); // age 1

        const v = s.getContextVector();
        expect(v.get("formula")).toBeCloseTo(0.9 + 0.81, 5); // ages 1,2
        expect(v.get("spreadsheet")).toBeCloseTo(0.9 + 0.729, 5); // ages 1,3
        expect(v.get("cell")).toBeCloseTo(0.81, 5); // age 2
        expect(v.get("excel")).toBeCloseTo(0.729, 5); // age 3
        expect(v.get("row")).toBeCloseTo(0.6561, 5); // age 4
    });

    it("is history-only — the current request is not recorded until after resolution", () => {
        const s = source();
        s.recordRequest("open the spreadsheet");
        // Simulate scoring the current turn BEFORE it is recorded.
        const v = s.getContextVector();
        expect(v.has("spreadsheet")).toBe(true);
        expect(v.has("row")).toBe(false); // "add a row" not yet recorded
    });

    it("caps the buffer at windowTurns, dropping the oldest", () => {
        const s = source({ windowTurns: 3 });
        for (let i = 0; i < 10; i++) {
            s.recordRequest(`topic${i}`);
        }
        expect(s.size).toBe(3);
        expect(s.snapshot()).toEqual(["topic7", "topic8", "topic9"]);
    });

    it("honors a shrunk window at scoring time", () => {
        let windowTurns = 20;
        const s = new RingBufferSignalSource(() => ({
            windowTurns,
            decay: 0.9,
        }));
        for (let i = 0; i < 5; i++) {
            s.recordRequest(`alpha${i}`);
        }
        windowTurns = 2;
        const v = s.getContextVector();
        // Only the last 2 turns contribute.
        expect(v.has("alpha4")).toBe(true);
        expect(v.has("alpha3")).toBe(true);
        expect(v.has("alpha2")).toBe(false);
    });

    it("ignores empty / whitespace-only requests", () => {
        const s = source();
        s.recordRequest("   ");
        s.recordRequest("");
        expect(s.size).toBe(0);
    });

    it("reset clears the buffer", () => {
        const s = source();
        s.recordRequest("spreadsheet formula");
        s.reset();
        expect(s.size).toBe(0);
        expect(s.getContextVector().size).toBe(0);
    });

    it("counts within-turn multiplicity", () => {
        const s = source();
        s.recordRequest("formula formula formula");
        // Single turn at age 1: three occurrences each weighted 0.9.
        expect(s.getContextVector().get("formula")).toBeCloseTo(0.9 * 3, 5);
    });
});
