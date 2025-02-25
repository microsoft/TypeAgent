// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mergeConfig, sanitizeConfig } from "../src/context/options.js";

describe("mergeConfig", () => {
    describe("strict", () => {
        it("should merge options into config", () => {
            const config = { a: 1, b: 2 };
            const options = { a: 10 };
            const changed = mergeConfig(config, options);
            expect(config).toEqual({ a: 10, b: 2 });
            expect(changed).toEqual({ a: 10 });
        });
        it("should merge options into config nested", () => {
            const config = { a: { b: 1, c: 2 }, d: 3 };
            const options = { a: { b: 10 } };
            const changed = mergeConfig(config, options);
            expect(config).toEqual({ a: { b: 10, c: 2 }, d: 3 });
            expect(changed).toEqual({ a: { b: 10 } });
        });
        it("should skip same value in changed", () => {
            const config = { a: 1 };
            const options = { a: 1 };
            const changed = mergeConfig(config, options);
            expect(config).toEqual({ a: 1 });
            expect(changed).toEqual({});
        });
        it("should ignore extra value", () => {
            const config = { a: 1 };
            const options = { b: "str" };
            const changed = mergeConfig(config, options);
            expect(config).toEqual({ a: 1 });
            expect(changed).toEqual({});
        });
        it("should throw on mismatch value type", () => {
            expect(() => {
                mergeConfig({ a: 1 }, { a: "str" });
            }).toThrow(
                "Invalid option 'a': type mismatch (expected: number, actual: string)",
            );
        });
        it("should throw on mismatched with nested value", () => {
            expect(() => {
                mergeConfig({ a: 1 }, { a: { b: 1 } });
            }).toThrow(
                "Invalid option 'a': type mismatch (expected: number, actual: object)",
            );
        });
        it("should add nested flex key", () => {
            const config = { a: { b: 0 } };
            const options = { a: { c: 1 } };
            const changed = mergeConfig(config, options, ["a"]);
            expect(config).toEqual({ a: { b: 0, c: 1 } });
            expect(changed).toEqual({ a: { c: 1 } });
        });
        it("should delete nested flex key", () => {
            const config = { a: { b: 0, c: 1 } };
            const options = { a: { c: null } };
            const changed = mergeConfig(config, options, ["a"]);
            expect(config).toEqual({ a: { b: 0 } });
            expect(changed).toEqual({ a: { c: null } });
        });
        it("should overwrite flex key mismatched with nested value", () => {
            const config = { a: 1 };
            const options = { a: { b: 1 } };
            const changed = mergeConfig(config, options, ["a"]);
            expect(config).toEqual({ a: { b: 1 } });
            expect(changed).toEqual({ a: { b: 1 } });
        });
    });
    describe("non-strict", () => {
        it("should merge options into config", () => {
            const config = { a: 1, b: 2 };
            const options = { a: 10 };
            const changed = mergeConfig(config, options, true);
            expect(config).toEqual({ a: 10, b: 2 });
            expect(changed).toEqual({ a: 10 });
        });
        it("should merge options into config nested", () => {
            const config = { a: { b: 1, c: 2 }, d: 3 };
            const options = { a: { b: 10 } };
            const changed = mergeConfig(config, options, true);
            expect(config).toEqual({ a: { b: 10, c: 2 }, d: 3 });
            expect(changed).toEqual({ a: { b: 10 } });
        });
        it("should skip same value in changed", () => {
            const config = { a: 1 };
            const options = { a: 1 };
            const changed = mergeConfig(config, options, true);
            expect(config).toEqual({ a: 1 });
            expect(changed).toEqual({});
        });
        it("should add extra value", () => {
            const config = { a: 1 };
            const options = { b: "str" };
            const changed = mergeConfig(config, options, true);
            expect(config).toEqual({ a: 1, b: "str" });
            expect(changed).toEqual({ b: "str" });
        });
        it("should overwrite mismatch value type", () => {
            const config = { a: 1 };
            const options = { a: "str" };
            const changed = mergeConfig(config, options, true);
            expect(config).toEqual({ a: "str" });
            expect(changed).toEqual({ a: "str" });
        });
        it("should overwrite with nested value", () => {
            const config = { a: 1 };
            const options = { a: { b: 1 } };
            const changed = mergeConfig(config, options, true);
            expect(config).toEqual({ a: { b: 1 } });
            expect(changed).toEqual({ a: { b: 1 } });
        });
    });
});

describe("sanitizeConfig", () => {
    it("should error on null value", () => {
        expect(() => {
            sanitizeConfig({ a: 1 }, { a: null });
        }).toThrow("Invalid option: 'a' cannot be null");
    });
    it("should ignore extraneous options", () => {
        const options = { b: undefined, c: 3 };
        const changed = sanitizeConfig({ a: 1 }, options);
        expect(changed).toEqual(false);
        expect(options).toEqual({ b: undefined, c: 3 });
    });
    it("should clear mismatch types", () => {
        const options = { a: "str", b: 2 };
        const changed = sanitizeConfig({ a: 1, b: 2 }, options);
        expect(changed).toEqual(true);
        expect(options).toEqual({ b: 2 });
    });

    it("should error on null value in nested objects", () => {
        expect(() => {
            sanitizeConfig({ d: { a: 1 } }, { d: { a: null } });
        }).toThrow("Invalid option: 'd.a' cannot be null");
    });
    it("should ignore extraneous options in nested objects", () => {
        const options = { d: { b: undefined, c: 3 } };
        const changed = sanitizeConfig({ a: 1 }, options);
        expect(changed).toEqual(false);
        expect(options).toEqual({ d: { b: undefined, c: 3 } });
    });
    it("should clear mismatch types in nested objects", () => {
        const options = { d: { a: "str", b: 2 } };
        const changed = sanitizeConfig({ d: { a: 1, b: 2 } }, options);
        expect(changed).toEqual(true);
        expect(options).toEqual({ d: { b: 2 } });
    });
});
