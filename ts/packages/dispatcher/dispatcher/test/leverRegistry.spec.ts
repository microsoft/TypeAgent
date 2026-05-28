// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    _clearRegistryForTest,
    getLever,
    listLevers,
    registerLever,
    type LeverPlugin,
} from "../src/neighborhoods/optimize/registry.js";

function stubLever(name: string): LeverPlugin {
    return {
        name,
        description: `${name} stub`,
        consumes: ["neighborhoods"],
        probeType: "translator",
        async proposeHypotheses() {
            return [];
        },
        async applyToSandbox() {
            return { filesWritten: [] };
        },
    };
}

describe("lever registry", () => {
    beforeEach(() => {
        _clearRegistryForTest();
    });

    afterEach(() => {
        _clearRegistryForTest();
    });

    it("returns undefined for unknown lever", () => {
        expect(getLever("nope")).toBeUndefined();
    });

    it("registers and retrieves a lever", () => {
        const lever = stubLever("alpha");
        registerLever(lever);
        expect(getLever("alpha")).toBe(lever);
    });

    it("rejects duplicate registration", () => {
        registerLever(stubLever("alpha"));
        expect(() => registerLever(stubLever("alpha"))).toThrow(
            /already registered/i,
        );
    });

    it("listLevers returns sorted by name", () => {
        registerLever(stubLever("zeta"));
        registerLever(stubLever("alpha"));
        registerLever(stubLever("mu"));
        const names = listLevers().map((l) => l.name);
        expect(names).toEqual(["alpha", "mu", "zeta"]);
    });

    it("clearing the registry removes all entries", () => {
        registerLever(stubLever("alpha"));
        _clearRegistryForTest();
        expect(listLevers()).toEqual([]);
        expect(getLever("alpha")).toBeUndefined();
    });
});
