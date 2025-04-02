// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { hasTestKeys, testIf } from "./testCommon.js";

/**
 * These are ONLINE
 */
describe("conversationIndex", () => {
    const testTimeout = 5 * 60 * 1000;

    testIf(
        "buildSemanticRefIndex",
        () => hasTestKeys(),
        async () => {},
        testTimeout,
    );
});
