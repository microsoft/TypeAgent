// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getActionProperty,
    ensureProperties,
} from "../src/explanation/validateExplanation.js";
import {
    JSONAction,
    ParamObjectType,
} from "../src/explanation/requestAction.js";

describe("validateExplanation", () => {
    describe("getActionProperty", () => {
        test("reads top-level property from JSONAction", () => {
            const action: JSONAction = {
                fullActionName: "test.doSomething",
                parameters: { volume: 7 },
            };
            const result = getActionProperty(action, "parameters.volume");
            expect(result).toBe(7);
        });

        test("reads nested property from ParamObjectType", () => {
            const params: ParamObjectType = {
                nested: { key: "hello" },
            };
            const result = getActionProperty(params, "nested.key");
            expect(result).toBe("hello");
        });

        test("reads array element by index", () => {
            const params: ParamObjectType = { items: ["a", "b", "c"] };
            const result = getActionProperty(params, "items.1");
            expect(result).toBe("b");
        });

        test("returns undefined for missing property", () => {
            const params: ParamObjectType = { volume: 5 };
            const result = getActionProperty(params, "missing");
            expect(result).toBeUndefined();
        });
    });

    describe("ensureProperties", () => {
        test("collects missing parameters for flat object", () => {
            const nameSet = new Set(["volume"]);
            const params: ParamObjectType = { volume: 5, artist: "Bach" };
            const corrections = ensureProperties(nameSet, params);
            expect(corrections).toHaveLength(1);
            expect(corrections[0]).toMatch(/artist/);
        });

        test("returns empty array when all properties are accounted for", () => {
            const nameSet = new Set(["volume", "artist"]);
            const params: ParamObjectType = { volume: 5, artist: "Bach" };
            const corrections = ensureProperties(nameSet, params);
            expect(corrections).toHaveLength(0);
        });

        test("handles nested objects via dotted keys", () => {
            const nameSet = new Set(["filter.year"]);
            const params: ParamObjectType = { filter: { year: 2024 } };
            const corrections = ensureProperties(nameSet, params);
            expect(corrections).toHaveLength(0);
        });
    });
});
