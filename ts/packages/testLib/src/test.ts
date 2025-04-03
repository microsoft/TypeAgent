// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { hasTestKeys } from "./models.js";

export function testIf(
    name: string,
    runIf: () => boolean,
    fn: jest.ProvidesCallback,
    testTimeout?: number | undefined,
) {
    if (!runIf()) {
        return test.skip(name, () => {});
    }
    return test(name, fn, testTimeout);
}

export function shouldSkip() {
    return !hasTestKeys();
}
