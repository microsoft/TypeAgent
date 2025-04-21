// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getObjectProperty } from "../src/objectProperty.js";
describe("getObjectProperty", () => {
    it("should return obj itself for empty string", () => {
        const obj = { a: 1, b: 2 };
        expect(getObjectProperty(obj, "")).toBe(obj);
    });
    it("should return the correct value for a simple property", () => {
        const obj = { a: 1, b: 2 };
        expect(getObjectProperty(obj, "a")).toBe(1);
        expect(getObjectProperty(obj, "b")).toBe(2);
    });
    it("should handle arrays correctly", () => {
        const obj = { a: [1, 2, 3] };
        expect(getObjectProperty(obj, "a.0")).toBe(1);
        expect(getObjectProperty(obj, "a.1")).toBe(2);
        expect(getObjectProperty(obj, "a.2")).toBe(3);
    });
    it("should handle nested arrays", () => {
        const obj = {
            a: [
                [1, 2],
                [4, 5],
            ],
        };
        expect(getObjectProperty(obj, "a.0.0")).toBe(1);
        expect(getObjectProperty(obj, "a.0.1")).toBe(2);
        expect(getObjectProperty(obj, "a.1.0")).toBe(4);
        expect(getObjectProperty(obj, "a.1.1")).toBe(5);
    });
    it("should return the correct value for a nested property", () => {
        const obj = { a: { b: { c: 3 } }, d: [{ e: 4 }] };
        expect(getObjectProperty(obj, "a.b.c")).toBe(3);
        expect(getObjectProperty(obj, "d.0.e")).toBe(4);
    });
    it("should return undefined for non-existent properties", () => {
        const obj = { a: 1, b: 2, c: [1] };
        expect(getObjectProperty(obj, "d")).toBeUndefined();
        expect(getObjectProperty(obj, "a.b")).toBeUndefined();
        expect(getObjectProperty(obj, "a.0")).toBeUndefined();
        expect(getObjectProperty(obj, "c.1")).toBeUndefined();
    });
    it("should handle empty objects", () => {
        const obj = {};
        expect(getObjectProperty(obj, "a")).toBeUndefined();
        expect(getObjectProperty(obj, "a.b")).toBeUndefined();
    });
    it("should handle empty arrays", () => {
        const obj: any = [];
        expect(getObjectProperty(obj, "a.0")).toBeUndefined();
    });
    it("should handle null values", () => {
        const obj = { a: null };
        expect(getObjectProperty(obj, "a")).toBeNull();
        expect(getObjectProperty(obj, "a.b")).toBeUndefined();
    });
    it("should handle undefined values", () => {
        const obj = { a: undefined };
        expect(getObjectProperty(obj, "a")).toBeUndefined();
        expect(getObjectProperty(obj, "a.b")).toBeUndefined();
    });
    it("should throw on invalid property names", () => {
        const obj = { a: 1, b: 2 };
        expect(() => getObjectProperty(obj, "__proto__")).toThrow(
            "Invalid property name: __proto__",
        );
        expect(() => getObjectProperty(obj, "constructor")).toThrow(
            "Invalid property name: constructor",
        );
        expect(() => getObjectProperty(obj, "prototype")).toThrow(
            "Invalid property name: prototype",
        );
    });
});
