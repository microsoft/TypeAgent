// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

function throwEnsureError(e: any): never {
    if (typeof e === "string") {
        throw new Error(e);
    }
    if (typeof e === "object") {
        if (e instanceof Error) {
            throw e;
        }
        const mayBeErrorLike = e as any;
        if (
            typeof mayBeErrorLike.message === "string" &&
            mayBeErrorLike.stack === "string"
        ) {
            throw e;
        }
    }
    throw new Error(`Unknown error: ${JSON.stringify(e)}`);
}

export function callEnsureError<T>(fn: () => T) {
    try {
        return fn();
    } catch (e) {
        throwEnsureError(e);
    }
}
