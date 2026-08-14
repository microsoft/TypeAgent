// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

describe("TEMP build-ts failure summary validation", () => {
    it("surfaces this intentional failure at the end of the test output", () => {
        expect("intentional pipeline failure").toBe("remove before merging");
    });
});
