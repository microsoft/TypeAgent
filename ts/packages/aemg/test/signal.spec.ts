// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { MemoryStore } from "../src/store.js";
import { SignalStore } from "../src/signal.js";

const DAY = 24 * 60 * 60 * 1000;

describe("SignalStore lazy decay", () => {
    it("decays strength exponentially toward zero over time", () => {
        const s = new SignalStore(14 * DAY); // 14-day half-life
        const t0 = 1_000_000;
        s.ensure("m", 1, t0);

        expect(s.strength("m", t0)).toBeCloseTo(1, 5);
        // After one half-life, strength ~= 0.5.
        expect(s.strength("m", t0 + 14 * DAY)).toBeCloseTo(0.5, 2);
        // After two half-lives, ~= 0.25.
        expect(s.strength("m", t0 + 28 * DAY)).toBeCloseTo(0.25, 2);
    });

    it("reinforcement decays forward then adds, resetting lastSeen", () => {
        const s = new SignalStore(14 * DAY);
        const t0 = 0;
        s.ensure("m", 1, t0);
        // At one half-life strength is ~0.5; reinforcing by 0.5 -> ~1.0.
        s.reinforce("m", 0.5, t0 + 14 * DAY);
        expect(s.strength("m", t0 + 14 * DAY)).toBeCloseTo(1.0, 2);
        expect(s.accessCount("m")).toBe(1);
    });

    it("pinned memories do not decay", () => {
        const s = new SignalStore(14 * DAY);
        const t0 = 0;
        s.ensure("m", 0.8, t0);
        s.pin("m", t0);
        expect(s.strength("m", t0 + 100 * DAY)).toBeCloseTo(0.8, 5);
        s.unpin("m", t0 + 100 * DAY);
        // After unpinning, decay resumes from the unpin time.
        expect(s.strength("m", t0 + 100 * DAY)).toBeCloseTo(0.8, 5);
        expect(s.strength("m", t0 + 114 * DAY)).toBeCloseTo(0.4, 2);
    });
});

describe("MemoryStore salience integration", () => {
    function makeStore(clockRef: { t: number }) {
        return new MemoryStore({
            now: () => clockRef.t,
            signalHalfLifeMs: 14 * DAY,
        });
    }

    function ingestSample(store: MemoryStore) {
        return store.ingest({
            conversationId: "c1",
            topic: "schema migration rollout",
            turns: [{ speaker: "user", text: "Let us plan the rollout" }],
        });
    }

    it("episode salience decays when not recalled", () => {
        const clock = { t: 0 };
        const store = makeStore(clock);
        const ep = ingestSample(store);

        const fresh = store.episodeStrength(ep.id);
        clock.t += 28 * DAY; // two half-lives
        const stale = store.episodeStrength(ep.id);
        expect(stale).toBeLessThan(fresh);
        expect(stale).toBeCloseTo(fresh * 0.25, 1);
    });

    it("recall reinforces an episode, slowing its fade", () => {
        const clock = { t: 0 };
        const store = makeStore(clock);
        const ep = ingestSample(store);

        clock.t += 14 * DAY;
        // Recall reinforces the surfaced episode.
        store.recall("schema migration rollout");
        const afterRecall = store.episodeStrength(ep.id);

        // A second, un-recalled episode of equal age would be weaker.
        expect(afterRecall).toBeGreaterThan(0.5);
    });

    it("pinned episodes keep full salience over long gaps", () => {
        const clock = { t: 0 };
        const store = makeStore(clock);
        const ep = ingestSample(store);
        const fresh = store.episodeStrength(ep.id);

        store.pinEpisode(ep.id);
        clock.t += 365 * DAY;
        expect(store.episodeStrength(ep.id)).toBeCloseTo(fresh, 5);
    });
});
