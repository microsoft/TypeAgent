// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { hasTestKeys } from "./models.js";

export function testIf(
    name: string,
    runIf: () => boolean,
    fn: jest.ProvidesCallback,
    testTimeout?: number | undefined,
) {
    if (runIf()) {
        test(name, fn, testTimeout);
    } else {
        test.skip(name, () => {});
    }
}

export function describeIf(
    name: string,
    runIf: () => boolean,
    describeFn: () => void,
) {
    if (runIf()) {
        describe(name, describeFn);
    } else {
        describe.skip(name, describeFn);
    }
}

export function shouldSkip() {
    return !hasTestKeys();
}
