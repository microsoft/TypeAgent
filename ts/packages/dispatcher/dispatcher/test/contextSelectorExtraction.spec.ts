// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Comprehensive validation of the context-EXTRACTION subsystem: the path from
// raw user turns to the decayed ContextVector the scorer consumes (design §7-8).
// This exercises RingBufferSignalSource + tokenize together as one unit — the
// per-module specs (contextSelectorSignal / contextSelectorTokenize) pin the
// arithmetic and vocabulary in isolation; here we validate the integrated
// behavior on realistic multi-turn conversations plus the adversarial inputs
// that stress it. Two adversarial families (negation, quoted speech) are
// *documented limitations* of the v1 lexical extractor — pinned here as the
// baseline the improvement increments move.

import { RingBufferSignalSource } from "../src/context/contextSelector/conversationSignal.js";

// decay 0.9, window 20 — the shipped defaults. age = turns-ago, newest prior
// turn is age 1, so a token recorded k turns before scoring weighs 0.9^k.
function source(windowTurns = 20, decay = 0.9) {
    return new RingBufferSignalSource(() => ({ windowTurns, decay }));
}

const D1 = 0.9; // 0.9^1
const D2 = 0.81; // 0.9^2
const D3 = 0.729; // 0.9^3

describe("contextSelector/extraction — realistic conversations", () => {
    it("builds a topical vector from a conversation, dropping stopwords + generic verbs", () => {
        const s = source();
        s.recordRequest("please open the budget spreadsheet"); // age 3
        s.recordRequest("edit the formula in that cell"); // age 2
        s.recordRequest("show me the pivot chart"); // age 1
        const v = s.getContextVector();

        // Newest turn (age 1) tokens weigh most.
        expect(v.get("pivot")).toBeCloseTo(D1, 5);
        expect(v.get("chart")).toBeCloseTo(D1, 5);
        expect(v.get("formula")).toBeCloseTo(D2, 5);
        expect(v.get("cell")).toBeCloseTo(D2, 5);
        expect(v.get("budget")).toBeCloseTo(D3, 5);
        expect(v.get("spreadsheet")).toBeCloseTo(D3, 5);

        // Glue words never enter the vector.
        for (const junk of [
            "please",
            "open",
            "the",
            "edit",
            "in",
            "that",
            "show",
            "me",
        ]) {
            expect(v.has(junk)).toBe(false);
        }
    });

    it("weights a more recent topic above an older one (recency ordering)", () => {
        const s = source();
        s.recordRequest("team meeting schedule"); // age 3
        s.recordRequest("calendar reminder"); // age 2
        s.recordRequest("spreadsheet formula"); // age 1
        const v = s.getContextVector();

        // A fresh spreadsheet word outweighs an older calendar/meeting word.
        expect(v.get("spreadsheet")!).toBeGreaterThan(v.get("schedule")!);
        expect(v.get("formula")!).toBeGreaterThan(v.get("calendar")!);
    });

    it("accumulates a token repeated across turns as summed decayed mass", () => {
        const s = source();
        s.recordRequest("spreadsheet work"); // age 3
        s.recordRequest("the spreadsheet"); // age 2
        s.recordRequest("spreadsheet again"); // age 1
        // 0.729 + 0.81 + 0.9
        expect(s.getContextVector().get("spreadsheet")).toBeCloseTo(
            D3 + D2 + D1,
            5,
        );
    });
});

describe("contextSelector/extraction — tokenization robustness", () => {
    it("strips punctuation, casing, and non-word symbols (emoji) from turns", () => {
        const s = source();
        s.recordRequest("SPREADSHEET!!! the FORMULA??? 📊💰");
        const v = s.getContextVector();
        expect(v.get("spreadsheet")).toBeCloseTo(D1, 5);
        expect(v.get("formula")).toBeCloseTo(D1, 5);
        expect(v.size).toBe(2); // no emoji / punctuation tokens
    });

    it("carries protected product / language / cell-ref patterns into the vector", () => {
        const s = source();
        s.recordRequest("debug the C# macro and the A1:B2 range");
        const v = s.getContextVector();
        expect(v.has("c#")).toBe(true);
        expect(v.has("a1:b2")).toBe(true);
        expect(v.has("macro")).toBe(true);
        expect(v.has("range")).toBe(true);
    });

    it("stems plural conversation words to the singular keys schema keywords use", () => {
        const s = source();
        s.recordRequest("the vampires need coffins");
        const v = s.getContextVector();
        // The scorer intersects with singular schema keywords ("vampire",
        // "coffin"); extraction must land on those same singular keys.
        expect(v.has("vampire")).toBe(true);
        expect(v.has("vampires")).toBe(false);
        expect(v.has("coffin")).toBe(true);
        expect(v.has("coffins")).toBe(false);
    });
});

describe("contextSelector/extraction — window + degenerate input", () => {
    it("evicts the oldest turns beyond the window", () => {
        const s = source(5);
        for (let i = 0; i < 8; i++) {
            s.recordRequest(`topic${i}`);
        }
        const v = s.getContextVector();
        // Only the last 5 turns (topic3..topic7) survive.
        expect(v.has("topic2")).toBe(false);
        expect(v.has("topic3")).toBe(true);
        expect(v.has("topic7")).toBe(true);
    });

    it("records a turn but yields no signal when every token is glue", () => {
        const s = source();
        s.recordRequest("the it is on to for"); // all stopwords
        s.recordRequest("add show get open"); // all generic verbs
        expect(s.size).toBe(2); // turns are buffered
        expect(s.getContextVector().size).toBe(0); // but contribute nothing
    });
});

// ---------------------------------------------------------------------------
// Documented adversarial limitations of the v1 lexical extractor. These pin the
// CURRENT behavior so the improvement increments can move it visibly. They are
// NOT desired behavior — see the negation-scope guard increment.
// ---------------------------------------------------------------------------
describe("contextSelector/extraction — adversarial (documented v1 limitations)", () => {
    it("LIMITATION: negation is not modeled — a negated topic still deposits full mass", () => {
        // "not"/"no" are stopwords (tokenize.ts), dropped before scoring, so the
        // extractor never sees the negation and the negated topic word fires at
        // full weight. This is the root cause of the adversarial loaded-negation
        // misroutes; the negation-scope guard tightens it.
        const s = source();
        s.recordRequest("do not open the spreadsheet"); // age 2
        s.recordRequest("no pivot chart"); // age 1
        const v = s.getContextVector();
        expect(v.has("spreadsheet")).toBe(true); // negated, yet present
        expect(v.has("pivot")).toBe(true); // negated, yet present
        expect(v.has("chart")).toBe(true); // negated, yet present
    });

    it("LIMITATION: quoted / reported speech is not distinguished from user intent", () => {
        // A third party's quoted instruction deposits its topical words exactly
        // as if the user had asked for them.
        const s = source();
        s.recordRequest("she said add eggs to the grocery list");
        const v = s.getContextVector();
        expect(v.has("grocery")).toBe(true);
        expect(v.has("list")).toBe(true);
    });
});
