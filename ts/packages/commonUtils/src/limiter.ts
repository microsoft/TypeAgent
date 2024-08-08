// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type Limiter = <T = void>(callback: () => Promise<T>) => Promise<T>;
export function createLimiter(limit: number): Limiter {
    let current = 0;
    let resolve: (() => void) | undefined = undefined;
    let p: Promise<void> | undefined = undefined;
    return async <T = void>(callback: () => Promise<T>) => {
        while (current >= limit) {
            if (p === undefined) {
                p = new Promise<void>((res) => (resolve = res));
            }
            await p;
        }
        current++;
        try {
            return await callback();
        } finally {
            current--;
            if (resolve !== undefined) {
                resolve();
                resolve = undefined;
                p = undefined;
            }
        }
    };
}
