// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { func1 } from "./testCode.js";
import { assertExpected } from "./debug.js";

export function runTests() {
    // Now test division
    let x = func1(15, 3, "%");
    // This fails
    assertExpected(x === 5);

    // Test multiplication
    x = func1(15, 3, "*");
    assertExpected(x === 45);

    // And test power
    x = func1(2, 4, "^");
    // This fails
    assertExpected(x === 16);
}
