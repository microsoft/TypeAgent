// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { MemoryStore } from "../src/store.js";
import { TrustTier } from "../src/trust.js";

describe("AEMG vertical slice", () => {
    // Scenario: "remember when we were doing X where you said Y and I said Z",
    // then the user corrects: "actually I said M, not Z".
    function setup() {
        const store = new MemoryStore();
        const episode = store.ingest({
            conversationId: "conv1",
            topic: "schema migration",
            actionIntent: "plan rollout",
            turns: [
                {
                    speaker: "assistant",
                    text: "We should do Y for the rollout",
                },
                { speaker: "user", text: "I think we need Z instead" },
            ],
            beliefs: [
                {
                    subject: "rollout",
                    predicate: "approach",
                    value: "Z",
                    speaker: "user",
                    turnIndex: 1,
                    trustTier: TrustTier.ExtractorInferred,
                    confidence: 0.6,
                },
            ],
        });
        return { store, episode };
    }

    it("captures an episode with participants and provenance", () => {
        const { episode } = setup();
        expect(episode.topic).toBe("schema migration");
        expect(episode.participants).toEqual(["assistant", "user"]);
        expect(episode.claims).toHaveLength(2);
        // Provenance points back to the exact turn text.
        expect(episode.claims[1].provenance.quote).toContain("Z");
    });

    it("recalls the episode from a fuzzy associative query", () => {
        const { store } = setup();
        const result = store.recall("remember the migration rollout plan");
        const top = result.items[0];
        expect(top.kind).toBe("episode");
        expect(top.provenance.length).toBeGreaterThan(0);
        expect(top.summary).toContain("schema migration");
    });

    it("applies a correction without deleting the prior belief", () => {
        const { store } = setup();

        const before = store.currentBelief("rollout", "approach");
        expect(before?.value).toBe("Z");

        store.correct({
            subject: "rollout",
            predicate: "approach",
            value: "M",
            reason: "user correction: I said M not Z",
            provenance: {
                sourceId: "conv1",
                turnIndex: 1,
                speaker: "user",
                quote: "Actually I said M, not Z",
            },
        });

        // Current belief is now the corrected value...
        const after = store.currentBelief("rollout", "approach");
        expect(after?.value).toBe("M");
        expect(after?.version).toBe(2);
        expect(after?.trustTier).toBe(TrustTier.UserAsserted);

        // ...but the superseded version is preserved with a link.
        const history = store.beliefHistory("rollout", "approach");
        expect(history.map((b) => b.value)).toEqual(["Z", "M"]);
        expect(history[0].supersededById).toBe(after?.id);
    });

    it("recall reflects the corrected belief with provenance", () => {
        const { store } = setup();
        store.correct({
            subject: "rollout",
            predicate: "approach",
            value: "M",
            provenance: {
                sourceId: "conv1",
                turnIndex: 1,
                speaker: "user",
                quote: "Actually I said M, not Z",
            },
        });

        const result = store.recall("rollout approach");
        const belief = result.items.find((i) => i.kind === "belief");
        expect(belief?.summary).toContain("M");
        expect(belief?.provenance[0].quote).toContain("M");
    });

    it("keeps the append-only observation log growing", () => {
        const { store } = setup();
        const before = store.observationCount;
        store.correct({
            subject: "rollout",
            predicate: "approach",
            value: "M",
            provenance: { sourceId: "conv1", turnIndex: 1, speaker: "user" },
        });
        expect(store.observationCount).toBe(before + 1);
    });
});
