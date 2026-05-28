// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Input-contract tests for `FormatOptions`.
 *
 * The formatter is publicly callable as `format(decl, options)`. Before
 * round-4-pass-4, out-of-contract option values either silently
 * produced garbled output (e.g. `eol: ""` collapsed every line) or
 * threw an opaque `RangeError` from inside `String.prototype.repeat`.
 *
 * These tests pin the validation contract:
 *
 *   - `indent`: non-negative integer (0, 1, 2, … 32, …).
 *   - `eol`:    one of `"\n"`, `"\r\n"`, `"\r"`.
 *   - `printWidth`: non-negative integer or `Infinity`.
 *
 * Invalid values throw `RangeError` / `TypeError` with a message that
 * names the offending field. The default-resolved options (when
 * `options` is omitted entirely) are always valid.
 */

import { format } from "./_testUtil.js";
import { Parser } from "../src/parser.js";
import { lex } from "../src/lexer.js";
import type { WorkflowDecl } from "../src/ast.js";

function parse(src: string): WorkflowDecl {
    const { tokens, comments } = lex(src);
    const { module, errors } = new Parser(tokens, comments).parseModule();
    if (errors.length || module.workflows.length === 0)
        throw new Error(errors.join("\n"));
    return module.workflows[0];
}

const SAMPLE = parse(`workflow w(a: number): number { return a; }`);

describe("FormatOptions input validation", () => {
    test("no options uses defaults and succeeds", () => {
        expect(() => format(SAMPLE)).not.toThrow();
        expect(() => format(SAMPLE, {})).not.toThrow();
        expect(() => format(SAMPLE, undefined)).not.toThrow();
    });

    describe("indent", () => {
        test("0 is allowed", () => {
            expect(() => format(SAMPLE, { indent: 0 })).not.toThrow();
        });

        test("positive integer is allowed", () => {
            for (const n of [1, 2, 4, 8, 32]) {
                expect(() => format(SAMPLE, { indent: n })).not.toThrow();
            }
        });

        test("negative is rejected", () => {
            expect(() => format(SAMPLE, { indent: -1 })).toThrow(/indent/);
            expect(() => format(SAMPLE, { indent: -1 })).toThrow(RangeError);
        });

        test("fractional is rejected", () => {
            expect(() => format(SAMPLE, { indent: 2.5 })).toThrow(/indent/);
            expect(() => format(SAMPLE, { indent: 2.5 })).toThrow(RangeError);
        });

        test("NaN is rejected", () => {
            expect(() => format(SAMPLE, { indent: NaN })).toThrow(/indent/);
        });

        test("Infinity is rejected", () => {
            expect(() => format(SAMPLE, { indent: Infinity })).toThrow(
                /indent/,
            );
        });

        test("non-number is rejected", () => {
            expect(() =>
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                format(SAMPLE, { indent: "4" as any }),
            ).toThrow(/indent/);
        });
    });

    describe("eol", () => {
        test("default is LF", () => {
            const out = format(SAMPLE);
            expect(out).toContain("\n");
            expect(out).not.toContain("\r");
        });

        test("\\r\\n is allowed", () => {
            const out = format(SAMPLE, { eol: "\r\n" });
            expect(out).toContain("\r\n");
        });

        test("\\r is allowed", () => {
            const out = format(SAMPLE, { eol: "\r" });
            // Bare CR present; should not contain LF.
            expect(out).toContain("\r");
            expect(out.split("\r").length).toBeGreaterThan(1);
        });

        test("empty string is rejected", () => {
            expect(() => format(SAMPLE, { eol: "" })).toThrow(/eol/);
            expect(() => format(SAMPLE, { eol: "" })).toThrow(RangeError);
        });

        test("non-line-terminator string is rejected", () => {
            expect(() => format(SAMPLE, { eol: "  " })).toThrow(/eol/);
            expect(() => format(SAMPLE, { eol: ";" })).toThrow(/eol/);
            expect(() => format(SAMPLE, { eol: "\t" })).toThrow(/eol/);
        });

        test("non-string is rejected", () => {
            expect(() =>
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                format(SAMPLE, { eol: 10 as any }),
            ).toThrow(/eol/);
        });
    });

    describe("printWidth", () => {
        test("0 is allowed (means always wrap)", () => {
            expect(() => format(SAMPLE, { printWidth: 0 })).not.toThrow();
        });

        test("positive integer is allowed", () => {
            for (const n of [1, 40, 80, 100, 1000]) {
                expect(() => format(SAMPLE, { printWidth: n })).not.toThrow();
            }
        });

        test("Infinity is allowed (means never wrap)", () => {
            expect(() =>
                format(SAMPLE, { printWidth: Infinity }),
            ).not.toThrow();
        });

        test("negative is rejected", () => {
            expect(() => format(SAMPLE, { printWidth: -1 })).toThrow(
                /printWidth/,
            );
            expect(() => format(SAMPLE, { printWidth: -1 })).toThrow(
                RangeError,
            );
        });

        test("fractional finite is rejected", () => {
            expect(() => format(SAMPLE, { printWidth: 80.5 })).toThrow(
                /printWidth/,
            );
        });

        test("NaN is rejected", () => {
            expect(() => format(SAMPLE, { printWidth: NaN })).toThrow(
                /printWidth/,
            );
        });

        test("non-number is rejected", () => {
            expect(() =>
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                format(SAMPLE, { printWidth: "100" as any }),
            ).toThrow(/printWidth/);
        });
    });
});
