// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ImmutableReadCache,
    ReadCacheInvalidatedError,
} from "../src/immutableReadCache.js";

test("privacy guards cover preparation before a cache load is registered", () => {
    const cache = new ImmutableReadCache<string>("test", 2, 20);
    const assertCurrent = cache.guard("corpus");
    cache.invalidate();
    expect(assertCurrent).toThrow(ReadCacheInvalidatedError);
    cache.close();
});

test("immutable readers share initialization and obey entry and byte bounds", async () => {
    const cache = new ImmutableReadCache<object>("test", 2, 10);
    let loads = 0;
    const load = async () => ({ value: { load: ++loads }, bytes: 5 });
    const [a, b] = await Promise.all([
        cache.get("a", "corpus", load),
        cache.get("a", "corpus", load),
    ]);
    expect(a).toBe(b);
    expect(loads).toBe(1);
    await cache.get("b", "corpus", load);
    await cache.get("a", "corpus", load);
    await cache.get("c", "corpus", load);
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.hasSpace(1)).toBe(false);
    cache.invalidate("corpus");
    expect(cache.hasSpace(10)).toBe(true);
    cache.close();
});

test("failed and oversized loads are not retained", async () => {
    const cache = new ImmutableReadCache<number>("test", 2, 10);
    await expect(
        cache.get("a", "corpus", async () => {
            throw new Error("load failed");
        }),
    ).rejects.toThrow("load failed");
    expect(
        await cache.get("a", "corpus", async () => ({
            value: 1,
            bytes: 11,
        })),
    ).toBe(1);
    expect(cache.has("a")).toBe(false);
    cache.close();
});

test("privacy invalidation rejects pending readers without affecting other corpora", async () => {
    const cache = new ImmutableReadCache<number>("test");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const pending = cache.get("a", "corpus", async () => {
        await gate;
        return { value: 1, bytes: 1 };
    });
    const rejected = expect(pending).rejects.toBeInstanceOf(
        ReadCacheInvalidatedError,
    );
    await cache.get("b", "other", async () => ({ value: 2, bytes: 1 }));
    cache.invalidate("corpus");
    release();
    await rejected;
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    cache.close();
    await expect(
        cache.get("b", "other", async () => ({ value: 3, bytes: 1 })),
    ).rejects.toBeInstanceOf(ReadCacheInvalidatedError);
});
