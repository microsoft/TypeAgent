// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getRunbookArgumentReferences,
    normalizeRunbookBindingArguments,
    runbookArgumentLimits,
    validateRunbookArgumentReadiness,
    validateRunbookBindingArguments,
} from "../src/runbookArguments.js";
import { runInNewContext } from "node:vm";

describe("bounded runbook argument templates", () => {
    it("preserves nested literals, references and escaped literal marker objects", () => {
        const args = {
            namespace: { $input: "namespace" },
            filters: [{ enabled: true, count: 2, missing: null }],
            escaped: { $literal: { $input: "literal-not-an-input" } },
            nested: { items: [{ $input: "namespace" }] },
            command: "echo this-is-text-only",
        };
        validateRunbookBindingArguments(args, [{ id: "namespace" }]);
        expect(getRunbookArgumentReferences(args)).toEqual(["namespace"]);
        expect(normalizeRunbookBindingArguments(args)).toEqual(args);
    });

    it("treats root marker keys as parameter names rather than whole-map escapes", () => {
        const args = {
            $literal: { nested: { $input: "credential" } },
            $input: "literal-parameter-value",
        };
        validateRunbookBindingArguments(args, [{ id: "credential" }]);
        expect(getRunbookArgumentReferences(args)).toEqual(["credential"]);
        expect(normalizeRunbookBindingArguments(args)).toEqual(args);
        const escapedParameter = {
            $literal: { $literal: { $input: "literal-not-an-input" } },
        };
        validateRunbookBindingArguments(escapedParameter, []);
        expect(getRunbookArgumentReferences(escapedParameter)).toEqual([]);
        expect(normalizeRunbookBindingArguments(escapedParameter)).toEqual(
            escapedParameter,
        );
    });

    it("accepts native JSON objects and arrays from other realms without accepting custom prototypes", () => {
        const foreign: unknown = runInNewContext(
            '({values: [1, {namespace: "ops"}]})',
        );
        validateRunbookBindingArguments(foreign);
        validateRunbookBindingArguments(structuredClone(foreign));
        expect(() =>
            validateRunbookBindingArguments({
                value: Object.create({ custom: true }),
            }),
        ).toThrow("plain JSON");
    });

    it.each([
        { value: { $input: "unknown" } },
        { value: { $input: 42 } },
        { value: { $input: "namespace", extra: true } },
        { value: { $literal: 42, extra: true } },
    ])("rejects unknown or ambiguous symbolic wrappers: %j", (args) => {
        expect(() =>
            validateRunbookBindingArguments(args, [{ id: "namespace" }]),
        ).toThrow();
    });

    it.each([undefined, NaN, Infinity, new Date(), () => undefined])(
        "rejects non-JSON values without coercion: %p",
        (value) => {
            expect(() => validateRunbookBindingArguments({ value })).toThrow();
        },
    );

    it("rejects cycles, sparse arrays, accessors and unsafe keys without invoking code", () => {
        const cyclic: { child?: unknown } = {};
        cyclic.child = cyclic;
        expect(() => validateRunbookBindingArguments(cyclic)).toThrow("cyclic");
        expect(() =>
            validateRunbookBindingArguments({ value: new Array(2) }),
        ).toThrow("sparse");
        let invoked = false;
        const accessor = Object.defineProperty({}, "value", {
            enumerable: true,
            get() {
                invoked = true;
                return "not JSON";
            },
        });
        expect(() => validateRunbookBindingArguments(accessor)).toThrow(
            "accessors",
        );
        expect(invoked).toBe(false);
        expect(() =>
            validateRunbookBindingArguments(JSON.parse('{"__proto__":true}')),
        ).toThrow("key");
    });

    it("checks exact string and encoded byte boundaries, including multibyte text", () => {
        const { maxStringLength, maxEncodedBytes } = runbookArgumentLimits;
        const overhead = new TextEncoder().encode(
            JSON.stringify({ first: "", second: "" }),
        ).length;
        const args = {
            first: "a".repeat(maxStringLength),
            second: "b".repeat(maxEncodedBytes - overhead - maxStringLength),
        };
        expect(new TextEncoder().encode(JSON.stringify(args)).length).toBe(
            maxEncodedBytes,
        );
        validateRunbookBindingArguments(args);
        expect(() =>
            validateRunbookBindingArguments({
                ...args,
                second: args.second + "b",
            }),
        ).toThrow("encoded");
        expect(() =>
            validateRunbookBindingArguments({
                value: "a".repeat(maxStringLength + 1),
            }),
        ).toThrow("string");
        expect(() =>
            validateRunbookBindingArguments({
                value: "\u00e9".repeat(maxStringLength),
            }),
        ).toThrow("encoded");
    });

    it("checks exact node and nesting boundaries", () => {
        const array = Array.from(
            { length: runbookArgumentLimits.maxNodes - 2 },
            () => null,
        );
        validateRunbookBindingArguments({ array });
        expect(() =>
            validateRunbookBindingArguments({ array: [...array, null] }),
        ).toThrow("limits");
        let value: unknown = "leaf";
        for (let depth = 1; depth < runbookArgumentLimits.maxDepth; depth++)
            value = { child: value };
        validateRunbookBindingArguments({ value });
        expect(() =>
            validateRunbookBindingArguments({ value: { child: value } }),
        ).toThrow("limits");
    });

    it("preserves secret input references but redacts literals even inside literal escapes", () => {
        const normalized = normalizeRunbookBindingArguments(
            {
                password: { $input: "credential" },
                headers: { authorization: { $input: "credential" } },
                payload: {
                    $literal: { password: { $input: "actually-literal-data" } },
                },
                apiKey: "private-value",
                known: "copied-private-value",
            },
            ["copied-private-value"],
        );
        expect(normalized.password).toEqual({ $input: "credential" });
        expect(normalized.headers).toEqual({
            authorization: { $input: "credential" },
        });

        expect(normalized.payload).toEqual({
            $literal: { password: "[REDACTED]" },
        });
        expect(JSON.stringify(normalized)).not.toContain("private-value");
        expect(() =>
            validateRunbookArgumentReadiness(normalized, [
                { id: "credential" },
            ]),
        ).toThrow("Redacted");
    });

    it("preserves declared apiKey references without evaluating literal strings", () => {
        const argumentsValue = {
            apiKey: { $input: "credential" },
            note: "${credential}",
        };
        const normalized = normalizeRunbookBindingArguments(argumentsValue);
        expect(normalized).toEqual(argumentsValue);
        expect(() =>
            validateRunbookArgumentReadiness(normalized, [
                { id: "credential" },
            ]),
        ).not.toThrow();
        expect(() => validateRunbookArgumentReadiness(normalized, [])).toThrow(
            "undeclared",
        );
    });

    it("redacts common catalog credential parameter names instead of retaining OAuth literals", () => {
        const normalized = normalizeRunbookBindingArguments({
            accessToken: "private-oauth-value",
            refresh_token: "private-refresh-value",
            clientSecret: { $input: "credential" },
            awsSecretAccessKey: "private-aws-value",
        });
        expect(normalized).toEqual({
            accessToken: "[REDACTED]",
            refresh_token: "[REDACTED]",
            clientSecret: { $input: "credential" },
            awsSecretAccessKey: "[REDACTED]",
        });
    });
});
