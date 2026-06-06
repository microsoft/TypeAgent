// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SignalStore, defaultSignalParams } from "../src/signalStore.js";

describe("SignalStore", () => {
    let store: SignalStore;
    const t0 = 1_700_000_000_000; // fixed epoch ms

    beforeEach(() => {
        store = new SignalStore(":memory:");
    });

    afterEach(() => {
        store.close();
    });

    test("ensure seeds an initial weight once", () => {
        store.ensure("rel:1", t0, 1);
        const a = store.getWeight("rel:1", t0);
        expect(a?.weight).toBeCloseTo(1, 6);

        // Second ensure must not overwrite the existing weight.
        store.reinforce("rel:1", t0, 1);
        store.ensure("rel:1", t0, 5);
        const b = store.getWeight("rel:1", t0);
        expect(b?.weight).toBeCloseTo(2, 6);
    });

    test("getWeight returns undefined for unknown relation", () => {
        expect(store.getWeight("missing", t0)).toBeUndefined();
    });

    test("weight decays exponentially over time", () => {
        store.ensure("rel:1", t0, 1);
        const lambda = defaultSignalParams.lambda;

        const oneDay = 86400 * 1000;
        const later = t0 + 30 * oneDay; // one half-life
        const w = store.getWeight("rel:1", later);
        expect(w?.weight).toBeCloseTo(0.5, 3);

        const expected = Math.exp(-lambda * (10 * 86400));
        const w10 = store.getWeight("rel:1", t0 + 10 * oneDay);
        expect(w10?.weight).toBeCloseTo(expected, 6);
    });

    test("reinforce decays then folds in new evidence", () => {
        store.ensure("rel:1", t0, 1);
        const oneDay = 86400 * 1000;
        const later = t0 + 30 * oneDay; // weight has decayed to ~0.5

        const newWeight = store.reinforce("rel:1", later, 1, 0);
        // decayed (~0.5) + alpha(1) * 1 = ~1.5
        expect(newWeight).toBeCloseTo(1.5, 3);
        expect(store.getWeight("rel:1", later)?.weight).toBeCloseTo(1.5, 3);
    });

    test("negative evidence reduces weight but never below zero", () => {
        store.ensure("rel:1", t0, 1);
        const w = store.reinforce("rel:1", t0, 0, 5);
        expect(w).toBe(0);
    });

    test("reinforce on a missing relation creates it", () => {
        const w = store.reinforce("rel:new", t0, 1, 0);
        expect(w).toBeCloseTo(1, 6);
        expect(store.getWeight("rel:new", t0)?.weight).toBeCloseTo(1, 6);
    });
});
