// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { MemoryStore } from "../src/store.js";
import { KnowledgeGraph } from "../src/graph.js";
import { spreadingActivation } from "../src/activation.js";

describe("spreading activation", () => {
    it("flows energy across typed edges, attenuating per hop", () => {
        const g = new KnowledgeGraph();
        g.addEntity("a");
        g.addEntity("b");
        g.addEntity("c");
        g.addEdge(
            KnowledgeGraph.entityId("a"),
            KnowledgeGraph.entityId("b"),
            "rel",
            1,
        );
        g.addEdge(
            KnowledgeGraph.entityId("b"),
            KnowledgeGraph.entityId("c"),
            "rel",
            1,
        );

        const seeds = new Map([[KnowledgeGraph.entityId("a"), 1]]);
        const act = spreadingActivation(g, seeds, {
            decay: 0.5,
            maxHops: 3,
            minActivation: 0.001,
        });

        const a = act.get(KnowledgeGraph.entityId("a")) ?? 0;
        const b = act.get(KnowledgeGraph.entityId("b")) ?? 0;
        const c = act.get(KnowledgeGraph.entityId("c")) ?? 0;
        // Nearer nodes accumulate more activation than farther ones.
        expect(a).toBeGreaterThan(b);
        expect(b).toBeGreaterThan(c);
        expect(c).toBeGreaterThan(0);
    });
});

describe("associative recall (beats lexical-only)", () => {
    function setup() {
        const store = new MemoryStore();
        // An episode whose topic/text shares NO word with "guitar".
        store.ingest({
            conversationId: "c1",
            topic: "weekend jam",
            turns: [
                { speaker: "user", text: "Brought the amp to the garage" },
                { speaker: "assistant", text: "Nice, how did it sound?" },
            ],
            beliefs: [
                {
                    subject: "Fender",
                    predicate: "is_a",
                    value: "guitar",
                    speaker: "user",
                    turnIndex: 0,
                },
            ],
        });
        return store;
    }

    it("finds an episode with zero lexical overlap via the graph", () => {
        const store = setup();

        // Lexical-only recall cannot reach the episode: "guitar" appears
        // nowhere in its topic or claims.
        const lexical = store.recall("guitar", { hybrid: false });
        const lexicalEpisode = lexical.items.find((i) => i.kind === "episode");
        expect(lexicalEpisode).toBeUndefined();

        // Associative recall reaches it: guitar -> Fender -> "weekend jam".
        const assoc = store.recallAssociative("guitar");
        const top = assoc.items[0];
        expect(top.kind).toBe("episode");
        expect(top.summary).toContain("weekend jam");
        expect(top.provenance.length).toBeGreaterThan(0);
    });

    it("hybrid recall fuses lexical and associative signals", () => {
        const store = setup();
        const hybrid = store.recall("guitar"); // hybrid defaults to true
        const episode = hybrid.items.find((i) => i.kind === "episode");
        expect(episode).toBeDefined();
        expect(episode?.summary).toContain("weekend jam");
    });

    it("builds a graph with entity and episode nodes", () => {
        const store = setup();
        // episode + weekend jam + Fender + guitar = 4 nodes minimum.
        expect(store.graphNodeCount).toBeGreaterThanOrEqual(4);
    });
});
