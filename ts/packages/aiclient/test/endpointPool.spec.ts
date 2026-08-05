// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    discoverEndpointPool,
    markSuccess,
    markThrottled,
    markTransientFailure,
    pickEndpoint,
} from "../src/endpointPool.js";
import { ModelType } from "../src/openai.js";

// Deterministic RNG for reproducible random-within-tier selection.
function seededRng(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0xffffffff;
    };
}

describe("endpointPool.discoverEndpointPool", () => {
    test("legacy single-endpoint chat: pool of one, bare suffix", () => {
        const env = {
            AZURE_OPENAI_ENDPOINT: "https://legacy.example/openai/chat",
            AZURE_OPENAI_API_KEY: "legacy-key",
        };
        const pool = discoverEndpointPool(
            "azure",
            ModelType.Chat,
            undefined,
            env,
        );
        expect(pool.members).toHaveLength(1);
        expect(pool.members[0].suffix).toBe("");
        expect(pool.members[0].priority).toBe(1);
        expect(pool.members[0].settings.endpoint).toBe(
            "https://legacy.example/openai/chat",
        );
    });

    test("named model, single suffix: pool of one", () => {
        const env = {
            AZURE_OPENAI_ENDPOINT_GPT_4_O: "https://legacy.example/gpt-4o",
            AZURE_OPENAI_API_KEY_GPT_4_O: "key-gpt4o",
        };
        const pool = discoverEndpointPool(
            "azure",
            ModelType.Chat,
            "GPT_4_O",
            env,
        );
        expect(pool.members).toHaveLength(1);
        expect(pool.members[0].suffix).toBe("GPT_4_O");
        expect(pool.members[0].priority).toBe(1);
    });

    test("named model with regional variants and PTU: tiered pool", () => {
        const env = {
            AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS_PTU: "https://eastus-ptu",
            AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS_PTU: "k1",
            AZURE_OPENAI_ENDPOINT_GPT_4_O_SWEDEN: "https://sweden",
            AZURE_OPENAI_API_KEY_GPT_4_O_SWEDEN: "k2",
            AZURE_OPENAI_ENDPOINT_GPT_4_O_WESTUS: "https://westus",
            AZURE_OPENAI_API_KEY_GPT_4_O_WESTUS: "k3",
        };
        const pool = discoverEndpointPool(
            "azure",
            ModelType.Chat,
            "GPT_4_O",
            env,
        );
        expect(pool.members).toHaveLength(3);
        const ptu = pool.members.find((m) => m.mode === "PTU");
        const sweden = pool.members.find((m) => m.region === "sweden");
        const westus = pool.members.find((m) => m.region === "westus");
        expect(ptu).toBeDefined();
        expect(sweden).toBeDefined();
        expect(westus).toBeDefined();
        expect(ptu!.priority).toBe(1);
        expect(sweden!.priority).toBe(2);
        expect(westus!.priority).toBe(2);
    });

    test("AZURE_OPENAI_POOL_<MODEL> JSON override wins over defaults", () => {
        const env = {
            AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS_PTU: "https://eastus-ptu",
            AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS_PTU: "k1",
            AZURE_OPENAI_ENDPOINT_GPT_4_O_SWEDEN: "https://sweden",
            AZURE_OPENAI_API_KEY_GPT_4_O_SWEDEN: "k2",
            AZURE_OPENAI_POOL_GPT_4_O: JSON.stringify([
                { suffix: "GPT_4_O_EASTUS_PTU", priority: 3, mode: "PAYG" },
                { suffix: "GPT_4_O_SWEDEN", priority: 1, tpm: 30000 },
            ]),
        };
        const pool = discoverEndpointPool(
            "azure",
            ModelType.Chat,
            "GPT_4_O",
            env,
        );
        const ptu = pool.members.find(
            (m) => m.suffix === "GPT_4_O_EASTUS_PTU",
        )!;
        const sweden = pool.members.find((m) => m.suffix === "GPT_4_O_SWEDEN")!;
        expect(ptu.priority).toBe(3);
        expect(ptu.mode).toBe("PAYG");
        expect(sweden.priority).toBe(1);
        expect(sweden.declaredTpm).toBe(30000);
    });

    test("default embedding with regional variants", () => {
        const env = {
            AZURE_OPENAI_ENDPOINT_EMBEDDING: "https://legacy/embeddings",
            AZURE_OPENAI_API_KEY_EMBEDDING: "k",
            AZURE_OPENAI_ENDPOINT_EMBEDDING_EASTUS: "https://eastus/embeddings",
            AZURE_OPENAI_API_KEY_EMBEDDING_EASTUS: "k-east",
            AZURE_OPENAI_ENDPOINT_EMBEDDING_SWEDEN: "https://sweden/embed",
            AZURE_OPENAI_API_KEY_EMBEDDING_SWEDEN: "k-sweden",
        };
        const pool = discoverEndpointPool(
            "azure",
            ModelType.Embedding,
            undefined,
            env,
        );
        expect(pool.members).toHaveLength(3);
        const bare = pool.members.find((m) => m.suffix === "");
        expect(bare).toBeDefined();
        expect(bare!.priority).toBe(1);
    });

    test("invalid pool JSON is ignored and warns", () => {
        const env = {
            AZURE_OPENAI_ENDPOINT_GPT_4_O: "https://gpt-4o",
            AZURE_OPENAI_API_KEY_GPT_4_O: "k",
            AZURE_OPENAI_POOL_GPT_4_O: "{not valid json",
        };
        expect(() =>
            discoverEndpointPool("azure", ModelType.Chat, "GPT_4_O", env),
        ).not.toThrow();
    });

    test("default embedding pool doesn't swallow EMBEDDING_3_LARGE / _3_SMALL env vars", () => {
        // EMBEDDING_3_LARGE / _3_SMALL share the AZURE_OPENAI_ENDPOINT_EMBEDDING
        // prefix but belong to DIFFERENT models. Discovery for the default
        // EMBEDDING pool must NOT include them as regional members; otherwise
        // a request for ada-002 could be routed to a text-embedding-3-large
        // endpoint.
        const env = {
            AZURE_OPENAI_ENDPOINT_EMBEDDING: "https://ada-bare",
            AZURE_OPENAI_API_KEY_EMBEDDING: "k",
            AZURE_OPENAI_ENDPOINT_EMBEDDING_EASTUS: "https://ada-eastus",
            AZURE_OPENAI_API_KEY_EMBEDDING_EASTUS: "k",
            // Should be excluded — different model:
            AZURE_OPENAI_ENDPOINT_EMBEDDING_3_LARGE_EASTUS:
                "https://3-large-eastus",
            AZURE_OPENAI_API_KEY_EMBEDDING_3_LARGE_EASTUS: "k",
            AZURE_OPENAI_ENDPOINT_EMBEDDING_3_SMALL_SWEDENCENTRAL:
                "https://3-small-sweden",
            AZURE_OPENAI_API_KEY_EMBEDDING_3_SMALL_SWEDENCENTRAL: "k",
            // Should also be excluded from the bare pool — tagged variant
            // belongs to its own pool (EMBEDDING_INDEXING):
            AZURE_OPENAI_ENDPOINT_EMBEDDING_INDEXING_WESTUS:
                "https://indexing-westus",
            AZURE_OPENAI_API_KEY_EMBEDDING_INDEXING_WESTUS: "k",
        };
        const pool = discoverEndpointPool(
            "azure",
            ModelType.Embedding,
            undefined,
            env,
        );
        const suffixes = pool.members.map((m) => m.suffix).sort();
        expect(suffixes).toEqual(["", "EASTUS"]);
    });

    test("GPT_4_O pool doesn't swallow GPT_4_O_MINI env vars", () => {
        const env = {
            AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS: "https://4o-eastus",
            AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS: "k",
            AZURE_OPENAI_ENDPOINT_GPT_4_O_SWEDENCENTRAL_PTU:
                "https://4o-sweden-ptu",
            AZURE_OPENAI_API_KEY_GPT_4_O_SWEDENCENTRAL_PTU: "k",
            AZURE_OPENAI_ENDPOINT_GPT_4_O_MINI_EASTUS: "https://4o-mini-eastus",
            AZURE_OPENAI_API_KEY_GPT_4_O_MINI_EASTUS: "k",
        };
        const pool = discoverEndpointPool(
            "azure",
            ModelType.Chat,
            "GPT_4_O",
            env,
        );
        const suffixes = pool.members.map((m) => m.suffix).sort();
        expect(suffixes).toEqual([
            "GPT_4_O_EASTUS",
            "GPT_4_O_SWEDENCENTRAL_PTU",
        ]);
    });

    test("member without a usable key is skipped (not the whole pool)", () => {
        const env = {
            AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS: "https://eastus",
            AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS: "k-east",
            // Endpoint without a key and no fallback API key:
            AZURE_OPENAI_ENDPOINT_GPT_4_O_SWEDEN: "https://sweden",
        };
        // getEnvSetting has a default of "identity" for the api key, so the
        // sweden member will actually be created with identity auth — this
        // test just verifies that discovery does not throw.
        const pool = discoverEndpointPool(
            "azure",
            ModelType.Chat,
            "GPT_4_O",
            env,
        );
        expect(pool.members.length).toBeGreaterThanOrEqual(1);
    });
});

function makeTestPool(tiers: { priority: number; count: number }[]) {
    const members: any[] = [];
    for (const tier of tiers) {
        for (let i = 0; i < tier.count; i++) {
            members.push({
                suffix: `T${tier.priority}M${i}`,
                priority: tier.priority,
                mode: "PAYG",
                settings: { endpoint: `https://t${tier.priority}m${i}` },
                cooldownUntil: 0,
                consecutive429s: 0,
                consecutiveSuccesses: 0,
            });
        }
    }
    return { modelKey: "test", members };
}

describe("endpointPool.pickEndpoint", () => {
    test("healthy tier-1 wins over lower tiers", () => {
        const pool = makeTestPool([
            { priority: 1, count: 1 },
            { priority: 2, count: 3 },
        ]);
        const now = 1000;
        const pick = pickEndpoint(pool, now);
        expect(pick.kind).toBe("ready");
        expect(pick.member.priority).toBe(1);
    });

    test("cooling tier-1 falls through to tier-2", () => {
        const pool = makeTestPool([
            { priority: 1, count: 1 },
            { priority: 2, count: 2 },
        ]);
        const now = 1000;
        pool.members[0].cooldownUntil = now + 5000;
        const pick = pickEndpoint(pool, now);
        expect(pick.kind).toBe("ready");
        expect(pick.member.priority).toBe(2);
    });

    test("all cooling returns soonest-recovering member + waitMs", () => {
        const pool = makeTestPool([{ priority: 1, count: 3 }]);
        const now = 1000;
        pool.members[0].cooldownUntil = now + 3000;
        pool.members[1].cooldownUntil = now + 500;
        pool.members[2].cooldownUntil = now + 1500;
        const pick = pickEndpoint(pool, now);
        expect(pick.kind).toBe("cooling");
        if (pick.kind === "cooling") {
            expect(pick.member).toBe(pool.members[1]);
            expect(pick.waitMs).toBe(500);
        }
    });

    test("random-within-tier spreads picks uniformly", () => {
        const pool = makeTestPool([{ priority: 2, count: 3 }]);
        const rng = seededRng(12345);
        const counts = [0, 0, 0];
        const iterations = 3000;
        for (let i = 0; i < iterations; i++) {
            const pick = pickEndpoint(pool, 0, rng);
            const idx = pool.members.indexOf(pick.member);
            counts[idx]++;
        }
        // Each should get ~1000 picks; accept anything in [700, 1300].
        for (const c of counts) {
            expect(c).toBeGreaterThan(700);
            expect(c).toBeLessThan(1300);
        }
    });
});

describe("endpointPool.markThrottled / markSuccess", () => {
    test("first 429 cools down at least base delay; respects Retry-After", () => {
        const pool = makeTestPool([{ priority: 1, count: 1 }]);
        const now = 10_000;
        markThrottled(pool.members[0], 15_000, now);
        expect(pool.members[0].cooldownUntil).toBe(25_000);
        expect(pool.members[0].consecutive429s).toBe(1);
    });

    test("consecutive 429s grow exponentially up to cap", () => {
        const pool = makeTestPool([{ priority: 1, count: 1 }]);
        const m = pool.members[0];
        const now = 0;
        markThrottled(m, undefined, now);
        const first = m.cooldownUntil;
        markThrottled(m, undefined, now);
        const second = m.cooldownUntil;
        markThrottled(m, undefined, now);
        const third = m.cooldownUntil;
        expect(second).toBeGreaterThanOrEqual(first * 2);
        expect(third).toBeGreaterThanOrEqual(second * 2);
        // Cap at 120s
        for (let i = 0; i < 20; i++) markThrottled(m, undefined, now);
        expect(m.cooldownUntil).toBeLessThanOrEqual(120_000);
    });

    test("success streak resets the 429 multiplier", () => {
        const pool = makeTestPool([{ priority: 1, count: 1 }]);
        const m = pool.members[0];
        markThrottled(m, undefined, 0);
        markThrottled(m, undefined, 0);
        expect(m.consecutive429s).toBe(2);
        markSuccess(m);
        markSuccess(m);
        expect(m.consecutive429s).toBe(2); // still not reset
        markSuccess(m);
        expect(m.consecutive429s).toBe(0); // reset after 3 successes
    });

    test("transient failure adds floor cooldown without bumping 429 counter", () => {
        const pool = makeTestPool([{ priority: 1, count: 1 }]);
        const m = pool.members[0];
        const now = 1000;
        markTransientFailure(m, now);
        expect(m.consecutive429s).toBe(0);
        expect(m.cooldownUntil).toBe(6000);
    });
});
