// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseActionCatalog, makeRegistry } from "../src/index.js";

describe("actionCatalog", () => {
    describe("parseActionCatalog (default formats)", () => {
        test("parses the documented block form", () => {
            const text = [
                '//   "excel.excel-range"',
                "//     setCellValue   { address, value, worksheetName? }",
                "//     getRangeValues { range, worksheetName? }",
            ].join("\n");

            const reg = parseActionCatalog(text);
            expect(reg.hasSchema("excel.excel-range")).toBe(true);
            expect(reg.hasAction("excel.excel-range", "setCellValue")).toBe(
                true,
            );
            expect(reg.hasAction("excel.excel-range", "getRangeValues")).toBe(
                true,
            );
            expect(reg.listActions("excel.excel-range")).toHaveLength(2);
        });

        test("parses the documented inline form", () => {
            const text =
                '//   "excel.excel-table"      — createTable, filterTable, sortTable';
            const reg = parseActionCatalog(text);
            expect(reg.hasSchema("excel.excel-table")).toBe(true);
            expect(reg.hasAction("excel.excel-table", "createTable")).toBe(
                true,
            );
            expect(reg.hasAction("excel.excel-table", "filterTable")).toBe(
                true,
            );
            expect(reg.hasAction("excel.excel-table", "sortTable")).toBe(true);
        });

        test("3-space indent does NOT match an action line (guards 'parameter mistake' annotations)", () => {
            const text = [
                '//   "excel.foo"',
                "//   bogus: should be ignored",
                "//     realAction { x }",
            ].join("\n");
            const reg = parseActionCatalog(text);
            expect(reg.hasAction("excel.foo", "bogus")).toBe(false);
            expect(reg.hasAction("excel.foo", "realAction")).toBe(true);
        });

        test("a 4-space indented line without '{' does NOT match an action line", () => {
            const text = [
                '//   "excel.foo"',
                "//     setSomething: a description",
                "//     realAction { x }",
            ].join("\n");
            const reg = parseActionCatalog(text);
            expect(reg.hasAction("excel.foo", "setSomething")).toBe(false);
            expect(reg.hasAction("excel.foo", "realAction")).toBe(true);
        });

        test("listSchemas includes every header encountered, in insertion order", () => {
            const text = [
                '//   "a"',
                "//     act1 { x }",
                '//   "b"',
                "//     act2 { y }",
            ].join("\n");
            const reg = parseActionCatalog(text);
            expect(reg.listSchemas()).toEqual(["a", "b"]);
        });

        test("inline form filters out tokens that aren't valid identifiers", () => {
            const text = '//   "foo" — validOne, 123bad, also-bad, validTwo';
            const reg = parseActionCatalog(text);
            expect(reg.listActions("foo").slice().sort()).toEqual([
                "validOne",
                "validTwo",
            ]);
        });

        test("empty input yields an empty registry", () => {
            const reg = parseActionCatalog("");
            expect(reg.listSchemas()).toEqual([]);
        });
    });

    describe("parseActionCatalog (custom regex overrides)", () => {
        test("custom header regex changes schema detection", () => {
            const text = "# schema: customSchema";
            const reg = parseActionCatalog(text, {
                schemaHeaderRegex: /^#\s+schema:\s+(\S+)$/,
                actionLineRegex: /^-\s+(\w+)/,
            });
            expect(reg.hasSchema("customSchema")).toBe(true);
        });
    });

    describe("makeRegistry", () => {
        test("wraps a pre-built map and exposes the same surface", () => {
            const map = new Map<string, Set<string>>([
                ["s1", new Set(["a", "b"])],
                ["s2", new Set(["c"])],
            ]);
            const reg = makeRegistry(map);
            expect(reg.hasSchema("s1")).toBe(true);
            expect(reg.hasSchema("nope")).toBe(false);
            expect(reg.hasAction("s1", "a")).toBe(true);
            expect(reg.hasAction("s1", "z")).toBe(false);
            expect(reg.listActions("s2")).toEqual(["c"]);
            expect(reg.listActions("nope")).toEqual([]);
            expect(reg.listSchemas().slice().sort()).toEqual(["s1", "s2"]);
        });
    });
});
