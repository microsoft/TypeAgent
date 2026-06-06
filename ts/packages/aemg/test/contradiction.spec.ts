// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { MemoryStore } from "../src/store.js";
import { TrustTier } from "../src/trust.js";

describe("contradiction quarantine", () => {
    it("keeps a lower-trust conflicting belief live and surfaces it", () => {
        const store = new MemoryStore();

        // High-trust user assertion establishes the belief.
        store.correct({
            subject: "deploy",
            predicate: "target",
            value: "staging",
            trustTier: TrustTier.UserAsserted,
            provenance: { sourceId: "c1", speaker: "user" },
        });

        // A lower-trust extractor inference disagrees. It must NOT overwrite
        // the user's assertion; both stay live, quarantined.
        store.ingest({
            conversationId: "c2",
            topic: "deployment chatter",
            turns: [{ speaker: "assistant", text: "I think target is prod" }],
            beliefs: [
                {
                    subject: "deploy",
                    predicate: "target",
                    value: "prod",
                    speaker: "assistant",
                    turnIndex: 0,
                    trustTier: TrustTier.ExtractorInferred,
                },
            ],
        });

        // Current belief is still the user's value.
        expect(store.currentBelief("deploy", "target")?.value).toBe("staging");

        // Recall surfaces the conflict instead of silently picking one.
        const result = store.recall("deploy target");
        const conflict = result.conflicts.find(
            (c) => c.subject === "deploy" && c.predicate === "target",
        );
        expect(conflict).toBeDefined();
        const values = conflict!.candidates.map((c) => c.value).sort();
        expect(values).toEqual(["prod", "staging"]);
    });

    it("an equal-or-higher-trust correction supersedes cleanly (no conflict)", () => {
        const store = new MemoryStore();
        store.correct({
            subject: "deploy",
            predicate: "target",
            value: "staging",
            trustTier: TrustTier.UserAsserted,
            provenance: { sourceId: "c1", speaker: "user" },
        });
        store.correct({
            subject: "deploy",
            predicate: "target",
            value: "prod",
            trustTier: TrustTier.UserAsserted,
            provenance: { sourceId: "c2", speaker: "user" },
        });

        expect(store.currentBelief("deploy", "target")?.value).toBe("prod");
        const result = store.recall("deploy target");
        expect(result.conflicts).toHaveLength(0);
    });
});
