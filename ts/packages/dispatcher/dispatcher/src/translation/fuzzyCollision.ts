// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Fuzzy / semantic action collision detection. Scaffolded in this PR — the wiring,
// types, and resolver hooks are all in place but the only shipped scorer is a
// PlaceholderScorer that returns 0 for all pairs (deterministically inert).
// A real `ActionEmbeddingScorer` is reserved for a follow-up PR; selecting it
// in config without the implementation falls back to placeholder with a warning.

import registerDebug from "debug";

const debugFuzzy = registerDebug("typeagent:dispatcher:collision:fuzzy");

export type ActionDescriptor = {
    schemaName: string;
    actionName: string;
    // Optional: action type comment / description from the schema, useful as
    // additional embedding input once a real scorer is wired up.
    description?: string | undefined;
};

export interface FuzzyScorer {
    /**
     * Returns cosine similarity in [0, 1]. 1 = identical meaning, 0 = unrelated.
     * Implementations should be idempotent and cheap to call repeatedly within
     * a single load — callers may invoke it across O(n²) action pairs.
     */
    score(a: ActionDescriptor, b: ActionDescriptor): Promise<number>;
}

export class PlaceholderScorer implements FuzzyScorer {
    async score(_a: ActionDescriptor, _b: ActionDescriptor): Promise<number> {
        return 0;
    }
}

/**
 * Stub for the real embedding-based scorer. Reserved file path and class
 * signature so the rest of the pipeline can be exercised. Calling score()
 * throws — `selectFuzzyScorer` is responsible for catching this case at
 * config time and degrading to PlaceholderScorer with a warning.
 */
export class ActionEmbeddingScorer implements FuzzyScorer {
    async score(_a: ActionDescriptor, _b: ActionDescriptor): Promise<number> {
        throw new Error(
            "ActionEmbeddingScorer is not implemented yet. " +
                "Use 'placeholder' for now or implement embedding-based scoring.",
        );
    }
}

export function selectFuzzyScorer(
    kind: "placeholder" | "actionEmbedding",
): FuzzyScorer {
    if (kind === "actionEmbedding") {
        debugFuzzy(
            "actionEmbedding scorer selected but not implemented; falling back to placeholder",
        );
        // Surface once at console too — without a logger this still reaches dev
        // sessions where the user is evaluating strategies. Keep the message
        // identical to the debug line so log filters can grep one string.
        console.warn(
            "[collision.fuzzy] actionEmbedding scorer is not implemented; falling back to placeholder",
        );
        return new PlaceholderScorer();
    }
    return new PlaceholderScorer();
}

export type FuzzyCollision = {
    a: ActionDescriptor;
    b: ActionDescriptor;
    similarity: number;
};

/**
 * Static-time pairwise scan: returns every pair whose similarity meets/exceeds
 * the threshold. With PlaceholderScorer this always returns []; this is the
 * correct default-safe behavior until a real scorer lands.
 */
export async function findFuzzyCollisions(
    actions: ActionDescriptor[],
    scorer: FuzzyScorer,
    threshold: number,
): Promise<FuzzyCollision[]> {
    const collisions: FuzzyCollision[] = [];
    for (let i = 0; i < actions.length; i++) {
        for (let j = i + 1; j < actions.length; j++) {
            const a = actions[i];
            const b = actions[j];
            // Don't fuzzy-match within a single schema; that's a different concern
            // (the LLM clarifies intra-schema action ambiguity already) and would
            // generate noisy duplicates against the same agent.
            if (a.schemaName === b.schemaName) {
                continue;
            }
            let similarity: number;
            try {
                similarity = await scorer.score(a, b);
            } catch (e) {
                // Defensive: a misconfigured scorer should not break agent load.
                debugFuzzy(
                    `scorer error for ${a.schemaName}.${a.actionName} vs ${b.schemaName}.${b.actionName}: ${e}`,
                );
                continue;
            }
            if (similarity >= threshold) {
                collisions.push({ a, b, similarity });
            }
        }
    }
    return collisions;
}

/**
 * Runtime variant: given the chosen action and the full action set, return
 * any actions in OTHER schemas whose similarity to the chosen action meets
 * the threshold — these are candidates the user might have meant.
 */
export async function isFuzzyCollisionForMatch(
    chosen: ActionDescriptor,
    allActions: ActionDescriptor[],
    scorer: FuzzyScorer,
    threshold: number,
): Promise<{ candidate: ActionDescriptor; similarity: number }[]> {
    const out: { candidate: ActionDescriptor; similarity: number }[] = [];
    for (const candidate of allActions) {
        if (candidate.schemaName === chosen.schemaName) {
            continue;
        }
        if (
            candidate.schemaName === chosen.schemaName &&
            candidate.actionName === chosen.actionName
        ) {
            continue;
        }
        let similarity: number;
        try {
            similarity = await scorer.score(chosen, candidate);
        } catch {
            continue;
        }
        if (similarity >= threshold) {
            out.push({ candidate, similarity });
        }
    }
    return out;
}
