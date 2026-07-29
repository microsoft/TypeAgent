// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createActionResultFromError,
    serializeError,
} from "../src/helpers/actionHelpers.js";

describe("serializeError", () => {
    it("captures message, name, and stack from an Error", () => {
        const s = serializeError(new Error("boom"));
        expect(s.message).toBe("boom");
        expect(s.name).toBe("Error");
        expect(typeof s.stack).toBe("string");
        expect(s.stack).toContain("boom");
    });

    it("wraps a non-Error thrown value as a message", () => {
        expect(serializeError("just a string")).toEqual({
            message: "just a string",
        });
        expect(serializeError(42)).toEqual({ message: "42" });
    });

    it("snapshots a thrown plain object as a JSON message", () => {
        expect(serializeError({ code: 404 })).toEqual({
            message: JSON.stringify({ code: 404 }),
        });
    });

    it("recursively serializes the cause chain", () => {
        const root = new Error("deployment does not exist");
        const wrapped: Error & { cause?: unknown } = new Error("fetch failed");
        wrapped.cause = root;
        const s = serializeError(wrapped);
        expect(s.message).toBe("fetch failed");
        expect(s.cause?.message).toBe("deployment does not exist");
    });

    it("captures AggregateError.errors", () => {
        const agg = new AggregateError(
            [new Error("a"), new Error("b")],
            "all failed",
        );
        const s = serializeError(agg);
        expect(s.message).toBe("all failed");
        expect(s.errors?.map((e) => e.message)).toEqual(["a", "b"]);
    });

    it("collects extra own-enumerable properties (e.g. HTTP status/body)", () => {
        const err = Object.assign(new Error("Not Found"), {
            status: 404,
            body: "deployment does not exist",
        });
        const s = serializeError(err);
        expect(s.extra).toEqual({
            status: 404,
            body: "deployment does not exist",
        });
    });

    it("does not recurse infinitely on a cyclic cause", () => {
        const a: Error & { cause?: unknown } = new Error("a");
        const b: Error & { cause?: unknown } = new Error("b");
        a.cause = b;
        b.cause = a;
        // Depth-capped: terminates rather than hanging/throwing.
        const s = serializeError(a);
        expect(s.message).toBe("a");
        expect(s.cause?.message).toBe("b");
        expect(() => JSON.stringify(s)).not.toThrow();
    });

    it("produces a JSON-serializable snapshot", () => {
        const err = Object.assign(new Error("x"), {
            cause: new Error("y"),
            status: 500,
        });
        expect(() => JSON.stringify(serializeError(err))).not.toThrow();
    });
});

describe("createActionResultFromError", () => {
    it("returns a bare error when no details are given", () => {
        expect(createActionResultFromError("nope")).toEqual({ error: "nope" });
    });

    it("omits errorDetails when undefined (no key present)", () => {
        expect("errorDetails" in createActionResultFromError("x")).toBe(false);
    });

    it("attaches errorDetails when provided", () => {
        const details = serializeError(new Error("boom"));
        const result = createActionResultFromError("boom", details);
        expect(result.error).toBe("boom");
        expect(result.errorDetails).toBe(details);
    });
});
