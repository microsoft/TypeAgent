// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    makeSession,
    makeDispatcher,
    makeCompletionResult,
    makeMultiGroupResult,
} from "./helpers.js";

// ── CompletionState.generation ────────────────────────────────────────────────

describe("PartialCompletionSession — CompletionState.generation", () => {
    test("generation is present in CompletionState", async () => {
        const result = makeCompletionResult(["song", "shuffle"], 4, {
            separatorMode: "optionalSpace",
        });
        const { session } = makeSession(makeDispatcher(result));

        session.update("play");
        await Promise.resolve();

        const state = session.getCompletionState();
        expect(state).toBeDefined();
        expect(typeof state!.generation).toBe("number");
    });

    test("generation stays the same when prefix changes within same level", async () => {
        const result = makeCompletionResult(["song", "shuffle"], 4, {
            separatorMode: "optionalSpace",
        });
        const { session } = makeSession(makeDispatcher(result));

        session.update("play");
        await Promise.resolve();

        const gen1 = session.getCompletionState()!.generation;

        session.update("plays");
        const gen2 = session.getCompletionState()!.generation;

        expect(gen2).toBe(gen1);
    });

    test("generation increments on D1 CONSUME sep-level transition (L0 → L1)", async () => {
        const result = makeMultiGroupResult(
            [
                { completions: ["alpha"], separatorMode: "optionalSpace" },
                { completions: ["beta"], separatorMode: "space" },
            ],
            4,
        );
        const { session } = makeSession(makeDispatcher(result));

        session.update("play");
        await Promise.resolve();

        // Level 0: "alpha" visible (optionalSpace at L0).
        const gen0 = session.getCompletionState()!.generation;

        // Type space → D1 consumes separator, charLevel=1 > menuSepLevel=0
        // → loadLevel(1) → generation increments.
        session.update("play ");
        const gen1 = session.getCompletionState()!.generation;

        expect(gen1).toBeGreaterThan(gen0);
    });

    test("generation increments on B1 NARROW level shift (L1 → L0)", async () => {
        const result = makeMultiGroupResult(
            [
                { completions: ["alpha"], separatorMode: "optionalSpace" },
                { completions: ["beta"], separatorMode: "space" },
            ],
            4,
        );
        const { session } = makeSession(makeDispatcher(result));

        session.update("play");
        await Promise.resolve();

        // Consume space → advance to L1.
        session.update("play ");
        const genL1 = session.getCompletionState()!.generation;

        // Backspace → narrow back to L0.
        session.update("play");
        const genL0 = session.getCompletionState()!.generation;

        expect(genL0).toBeGreaterThan(genL1);
    });

    test("generation increments on new session result", async () => {
        const result1 = makeCompletionResult(["song"], 4, {
            separatorMode: "optionalSpace",
        });
        const result2 = makeCompletionResult(["track"], 5, {
            separatorMode: "optionalSpace",
        });
        const dispatcher = makeDispatcher(result1);
        const { session } = makeSession(dispatcher);

        session.update("play");
        await Promise.resolve();

        const gen1 = session.getCompletionState()!.generation;

        // Trigger re-fetch with new result.
        dispatcher.getCommandCompletion.mockResolvedValue(result2);
        session.update("other");
        await Promise.resolve();

        const gen2 = session.getCompletionState()!.generation;
        expect(gen2).toBeGreaterThan(gen1);
    });

    test("same prefix but different generation after sep-level transition", async () => {
        // Both optionalSpace (L0) and space (L1 only) items.
        // At L0 prefix="" shows optionalSpace items.
        // After typing space, L1 prefix="" shows both items.
        // Prefix is "" in both cases but generation differs.
        const result = makeMultiGroupResult(
            [
                { completions: ["alpha"], separatorMode: "optionalSpace" },
                { completions: ["beta"], separatorMode: "space" },
            ],
            4,
        );
        const { session } = makeSession(makeDispatcher(result));

        session.update("play");
        await Promise.resolve();

        const state0 = session.getCompletionState()!;
        expect(state0.prefix).toBe("");
        const itemsL0 = state0.items.map((i) => i.matchText);

        // Space consumed → level transition.
        session.update("play ");
        const state1 = session.getCompletionState()!;
        expect(state1.prefix).toBe("");
        const itemsL1 = state1.items.map((i) => i.matchText);

        // Same prefix, different generation, different items.
        expect(state1.generation).not.toBe(state0.generation);
        expect(itemsL1).not.toEqual(itemsL0);
        expect(itemsL0).toContain("alpha");
        expect(itemsL0).not.toContain("beta");
        expect(itemsL1).toContain("alpha");
        expect(itemsL1).toContain("beta");
    });
});
