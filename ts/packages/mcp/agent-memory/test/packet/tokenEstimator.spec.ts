// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ConservativeTokenEstimator } from "../../src/packet/index.js";

describe("ConservativeTokenEstimator", () => {
    const estimator = new ConservativeTokenEstimator();

    test("estimates UTF-8 text deterministically", () => {
        expect(estimator.estimate("")).toBe(0);
        expect(estimator.estimate("abcdef")).toBe(6);
        expect(estimator.estimate("field graph memory")).toBe(
            estimator.estimate("field graph memory"),
        );
    });

    test("accounts for multibyte input", () => {
        expect(estimator.estimate("ééé")).toBe(6);
        expect(estimator.estimate("量子")).toBe(6);
    });
});
