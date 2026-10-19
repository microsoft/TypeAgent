// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Small pure helpers shared across modules.

/** Closest option within edit distance ~len/3, for "did you mean". */
export function nearest(word: string, options: string[]): string | undefined {
    let best: string | undefined;
    let bestD = Math.max(2, Math.floor(word.length / 3)) + 1;
    for (const o of options) {
        const d = levenshtein(word, o);
        if (d < bestD) {
            best = o;
            bestD = d;
        }
    }
    return best;
}

function levenshtein(a: string, b: string): number {
    const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        let prev = dp[0];
        dp[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const tmp = dp[j];
            dp[j] = Math.min(
                dp[j] + 1,
                dp[j - 1] + 1,
                prev + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
            prev = tmp;
        }
    }
    return dp[b.length];
}

/** Run `fn` over items with at most `limit` in flight. */
export async function runLimited<T>(
    items: T[],
    limit: number,
    fn: (t: T) => Promise<unknown>,
) {
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (next < items.length) await fn(items[next++]);
        }),
    );
}
