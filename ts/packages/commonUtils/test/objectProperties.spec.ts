// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getObjectProperty, setObjectProperty } from "../src/objectProperty.js";
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
    it("should return undefined for index on an object", () => {
        const obj = { a: { b: 1 } };
        expect(getObjectProperty(obj, "a.0")).toBeUndefined();
    });
    it("should return undefined for property on array", () => {
        const obj = { a: [0] };
        expect(getObjectProperty(obj, "a.b")).toBeUndefined();
    });
});

describe("setObjectProperty", () => {
    it("should set a property on an object", () => {
        const obj: any = {};
        setObjectProperty({ obj }, "obj", "a", 1);
        expect(obj.a).toBe(1);
    });
    it("should set a property on a nested object", () => {
        const obj: any = { a: {} };
        setObjectProperty({ obj }, "obj", "a.b", 2);
        expect(obj.a.b).toBe(2);
    });
    it("should set a property on an array", () => {
        const obj: any = { a: [] };
        setObjectProperty({ obj }, "obj", "a.0", 3);
        expect(obj.a[0]).toBe(3);
    });
    it("should set a property on a nested array", () => {
        const obj: any = { a: [[], []] };
        setObjectProperty({ obj }, "obj", "a.0.0", 4);
        expect(obj.a[0][0]).toBe(4);
    });
    it("should set a property on an empty object", () => {
        const obj: any = {};
        setObjectProperty({ obj }, "obj", "a", 5);
        expect(obj.a).toBe(5);
    });
    it("should set a property on an empty array", () => {
        const obj: any = [];
        setObjectProperty({ obj }, "obj", "0", 6);
        expect(obj[0]).toBe(6);
    });
    it("should throw a property on a null value", () => {
        const obj: any = { a: null };
        expect(() => setObjectProperty({ obj }, "obj", "a.b", 7)).toThrow(
            "Cannot set property 'b' on null property 'a'",
        );
    });
    it("should set a property on an undefined value", () => {
        const obj: any = { a: undefined };
        setObjectProperty({ obj }, "obj", "a.b", 8);
        expect(obj.a).toEqual({ b: 8 });
    });
    it("should throw on invalid property names", () => {
        const obj: any = { a: 1, b: 2 };
        expect(() => setObjectProperty({ obj }, "obj", "__proto__", 9)).toThrow(
            "Invalid property name: __proto__",
        );
        expect(() =>
            setObjectProperty({ obj }, "obj", "constructor", 10),
        ).toThrow("Invalid property name: constructor");
        expect(() =>
            setObjectProperty({ obj }, "obj", "prototype", 11),
        ).toThrow("Invalid property name: prototype");
    });
    it("should throw setting index on root object", () => {
        const obj: any = { a: 1, b: 2 };
        expect(() => setObjectProperty({ obj }, "obj", "0", 12)).toThrow(
            "Cannot set index '0' on object property 'obj'",
        );
    });
    it("should throw setting property on root array", () => {
        const obj: any = [1, 2];
        expect(() => setObjectProperty({ obj }, "obj", "a", 13)).toThrow(
            "Cannot set property 'a' on array property 'obj'",
        );
    });
    it("should override setting index on object", () => {
        const obj: any = { a: 1, b: 2 };
        const data = { obj };
        setObjectProperty(data, "obj", "0", 12, true);
        expect(Array.isArray(data.obj)).toBe(true);
        expect(data.obj[0]).toBe(12);
    });
    it("should override setting property on array", () => {
        const obj: any = [1, 2];
        const data = { obj };
        setObjectProperty(data, "obj", "a", 13, true);
        expect(Array.isArray(data.obj)).toBe(false);
        expect(data.obj.a).toBe(13);
    });
});
