// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

type PromiseWithResolvers<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: any) => void;
};

export const createPromiseWithResolvers: <T>() => PromiseWithResolvers<T> = (
    Promise as any
).withResolvers
    ? (Promise as any).withResolvers.bind(Promise)
    : createPromiseWithResolversPolyfill;

function createPromiseWithResolversPolyfill<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: any) => void;
} {
    const result: any = {};
    result.promise = new Promise<T>((resolve, reject) => {
        result.resolve = resolve;
        result.reject = reject;
    });
    return result;
}
