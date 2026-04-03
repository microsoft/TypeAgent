// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRulesNoThrow } from "../src/grammarLoader.js";
import { SchemaCreator } from "@typeagent/action-schema";
import type { SchemaLoader } from "../src/grammarCompiler.js";

// Schema: { actionName: string, count: number, label: string, active: boolean }
const ExprActionDef = SchemaCreator.intf(
    "ExprAction",
    SchemaCreator.obj({
        actionName: SchemaCreator.field(SchemaCreator.string("test")),
        count: SchemaCreator.field(SchemaCreator.number()),
        label: SchemaCreator.field(SchemaCreator.string()),
        active: SchemaCreator.field(SchemaCreator.boolean()),
    }),
    undefined,
    true,
);
const exprLoader: SchemaLoader = (typeName) =>
    typeName === "ExprAction" ? ExprActionDef : undefined;
const exprOpts = {
    schemaLoader: exprLoader,
    enableValueExpressions: true,
};

describe("expression type inference", () => {
    it("template literal inferred as string - valid in string field", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)
                -> { actionName: "test", count: 0, label: \`hello \${name}\`, active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(0);
    });

    it("template literal in number field produces error", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)
                -> { actionName: "test", count: \`hello \${name}\`, label: "x", active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain("expected number");
    });

    it("arithmetic expression inferred as number", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(n:number)
                -> { actionName: "test", count: n * 2, label: "x", active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(0);
    });

    it("arithmetic expression in string field produces error", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(n:number)
                -> { actionName: "test", count: 0, label: n * 2, active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain("expected string");
    });

    it("comparison expression inferred as boolean", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(n:number)
                -> { actionName: "test", count: n, label: "x", active: n > 0 };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(0);
    });

    it("comparison in number field produces error", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(n:number)
                -> { actionName: "test", count: n > 0, label: "x", active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain("expected number");
    });

    it("typeof inferred as string", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(x:string)
                -> { actionName: "test", count: 0, label: typeof x, active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(0);
    });

    it("negation (!) requires boolean operand", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(x:string)
                -> { actionName: "test", count: 0, label: "x", active: !x };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0]).toContain("!");
        expect(errors[0]).toContain("boolean");
    });

    it("negation (!) on boolean is valid", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(n:number)
                -> { actionName: "test", count: 0, label: "x", active: !(n > 0) };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(0);
    });

    it("unary minus inferred as number", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(n:number)
                -> { actionName: "test", count: -n, label: "x", active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(0);
    });

    it("ternary with same-type branches inferred correctly", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(n:number)
                -> { actionName: "test", count: n > 0 ? n : 0, label: "x", active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(0);
    });

    it("string + number produces error (use template literal)", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(n:number)
                -> { actionName: "test", count: 0, label: "count: " + n, active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0]).toContain("+");
        expect(errors[0]).toContain("template literal");
    });

    it("string + string is valid", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)
                -> { actionName: "test", count: 0, label: "hello " + name, active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(0);
    });

    it("toLowerCase inferred as string", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)
                -> { actionName: "test", count: 0, label: name.toLowerCase(), active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(0);
    });

    it("indexOf on string inferred as number", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)
                -> { actionName: "test", count: name.indexOf("x"), label: "x", active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(0);
    });

    it("includes on string inferred as boolean", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)
                -> { actionName: "test", count: 0, label: "x", active: name.includes("y") };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(0);
    });

    it("string length property inferred as number", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)
                -> { actionName: "test", count: name.length, label: "x", active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(0);
    });

    it("array filter produces error (callback method not supported)", () => {
        // filter requires a callback, which is not supported in grammar expressions
        const ArrayActionDef = SchemaCreator.intf(
            "ArrayAction",
            SchemaCreator.obj({
                actionName: SchemaCreator.field(SchemaCreator.string("test")),
                items: SchemaCreator.field(
                    SchemaCreator.array(SchemaCreator.string()),
                ),
            }),
            undefined,
            true,
        );
        const arrayLoader: SchemaLoader = (typeName) =>
            typeName === "ArrayAction" ? ArrayActionDef : undefined;
        const grammarText = `
            import { ArrayAction } from "schema.ts";
            <Start> : ArrayAction = test $(name:string)
                -> { actionName: "test", items: [name].filter(name) };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: arrayLoader,
            enableValueExpressions: true,
        });
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0]).toContain("filter");
    });

    it("array includes inferred as boolean", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)
                -> { actionName: "test", count: 0, label: "x", active: ["a", "b"].includes(name) };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(0);
    });

    it("array join inferred as string", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)
                -> { actionName: "test", count: 0, label: ["a", name].join(", "), active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(0);
    });

    it("array indexOf inferred as number", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)
                -> { actionName: "test", count: ["a", "b"].indexOf(name), label: "x", active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(0);
    });

    it("number toFixed inferred as string", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(n:number)
                -> { actionName: "test", count: 0, label: n.toFixed(2), active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(0);
    });

    it("number toFixed in number field produces error", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(n:number)
                -> { actionName: "test", count: n.toFixed(2), label: "x", active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain("expected number");
    });

    it("array literal element types are inferred", () => {
        const ArrayActionDef = SchemaCreator.intf(
            "ArrayAction",
            SchemaCreator.obj({
                actionName: SchemaCreator.field(SchemaCreator.string("test")),
                items: SchemaCreator.field(
                    SchemaCreator.array(SchemaCreator.string()),
                ),
            }),
            undefined,
            true,
        );
        const arrayLoader: SchemaLoader = (typeName) =>
            typeName === "ArrayAction" ? ArrayActionDef : undefined;
        const grammarText = `
            import { ArrayAction } from "schema.ts";
            <Start> : ArrayAction = test $(name:string)
                -> { actionName: "test", items: [name, "literal"] };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: arrayLoader,
            enableValueExpressions: true,
        });
        expect(errors.length).toBe(0);
    });

    it("split returns string array", () => {
        const ArrayActionDef = SchemaCreator.intf(
            "ArrayAction",
            SchemaCreator.obj({
                actionName: SchemaCreator.field(SchemaCreator.string("test")),
                items: SchemaCreator.field(
                    SchemaCreator.array(SchemaCreator.string()),
                ),
            }),
            undefined,
            true,
        );
        const arrayLoader: SchemaLoader = (typeName) =>
            typeName === "ArrayAction" ? ArrayActionDef : undefined;
        const grammarText = `
            import { ArrayAction } from "schema.ts";
            <Start> : ArrayAction = test $(name:string)
                -> { actionName: "test", items: name.split(",") };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: arrayLoader,
            enableValueExpressions: true,
        });
        expect(errors.length).toBe(0);
    });
});

describe("operator type restrictions", () => {
    // ── Operator restriction errors ──────────────────────────────────

    it("string - number produces error", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string) $(n:number)
                -> { actionName: "test", count: name - n, label: "x", active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0]).toContain("-");
        expect(errors[0]).toContain("number");
    });

    it("string < number produces error", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string) $(n:number)
                -> { actionName: "test", count: 0, label: "x", active: name < n };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0]).toContain("<");
    });

    it("!string_var produces error", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)
                -> { actionName: "test", count: 0, label: "x", active: !name };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0]).toContain("!");
        expect(errors[0]).toContain("boolean");
    });

    it("string ternary test produces error", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)
                -> { actionName: "test", count: 0, label: name ? "yes" : "no", active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0]).toContain("boolean");
    });

    it("unary -string_var produces error", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)
                -> { actionName: "test", count: -name, label: "x", active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0]).toContain("-");
    });

    it("string && string produces error", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(x:string) $(y:string)
                -> { actionName: "test", count: 0, label: "x", active: x && y };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0]).toContain("&&");
        expect(errors[0]).toContain("boolean");
    });

    it("number || number produces error", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(x:number) $(y:number)
                -> { actionName: "test", count: 0, label: "x", active: x || y };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0]).toContain("||");
        expect(errors[0]).toContain("boolean");
    });

    it("number.unknownMethod() produces error with supported methods", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(n:number)
                -> { actionName: "test", count: 0, label: n.trim(), active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0]).toContain("trim");
        expect(errors[0]).toContain("Supported methods");
        expect(errors[0]).toContain("toString");
    });

    it("string.flat() produces error with supported methods", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)
                -> { actionName: "test", count: 0, label: name.flat(), active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0]).toContain("flat");
        expect(errors[0]).toContain("toLowerCase");
    });

    // ── ERROR_TYPE cascading (no secondary errors) ───────────────────

    it("unknown_var + 1 does not produce secondary type errors", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)
                -> { actionName: "test", count: unknown_var + 1, label: "x", active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        // Compiler may report its own variable-not-defined error;
        // the key check: no secondary "+" type error from cascading
        expect(errors.some((e) => e.includes("+"))).toBe(false);
    });

    it("unknown_var.length does not produce secondary property errors", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)
                -> { actionName: "test", count: unknown_var.length, label: "x", active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        // Should not produce a secondary "Property 'length' does not exist" error
        expect(errors.some((e) => e.includes("Property"))).toBe(false);
    });

    it("unknown_var > 0 ? a : b does not produce secondary cascading errors", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)
                -> { actionName: "test", count: 0, label: unknown_var > 0 ? "a" : "b", active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        // Should not produce secondary "Ternary test not boolean" errors
        expect(errors.some((e) => e.includes("Ternary"))).toBe(false);
    });

    it("unknown_var.toLowerCase() does not produce secondary method errors", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)
                -> { actionName: "test", count: 0, label: unknown_var.toLowerCase(), active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.some((e) => e.includes("Method"))).toBe(false);
    });

    it("-unknown_var does not produce secondary unary errors", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)
                -> { actionName: "test", count: -unknown_var, label: "x", active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.some((e) => e.includes("Unary"))).toBe(false);
    });

    it("!unknown_var does not produce secondary boolean errors", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)
                -> { actionName: "test", count: 0, label: "x", active: !unknown_var };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.some((e) => e.includes("requires a boolean"))).toBe(
            false,
        );
    });

    it("unknown_var && true does not produce secondary logical errors", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)
                -> { actionName: "test", count: 0, label: "x", active: unknown_var && true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(
            errors.some((e) => e.includes("requires boolean operands")),
        ).toBe(false);
    });

    it("unknown_var ?? 'default' does not produce secondary warnings", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)
                -> { actionName: "test", count: 0, label: unknown_var ?? "default", active: true };
        `;
        const errors: string[] = [];
        const warnings: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            warnings,
            exprOpts,
        );
        expect(warnings.some((w) => w.includes("unnecessary"))).toBe(false);
    });

    it("template with unknown_var does not produce secondary interpolation errors", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)
                -> { actionName: "test", count: 0, label: \`hello \${unknown_var}\`, active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.some((e) => e.includes("interpolation"))).toBe(false);
    });

    // ── Valid operations ─────────────────────────────────────────────

    it("number + number is valid", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(n:number) $(m:number)
                -> { actionName: "test", count: n + m, label: "x", active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(0);
    });

    it("string < string is valid", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(x:string) $(y:string)
                -> { actionName: "test", count: 0, label: "x", active: x < y };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(0);
    });

    it("boolean && boolean is valid", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(n:number) $(m:number)
                -> { actionName: "test", count: 0, label: "x", active: (n > 0) && (m < 10) };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(0);
    });

    it("!(boolean) is valid", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(n:number)
                -> { actionName: "test", count: 0, label: "x", active: !(n > 0) };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(0);
    });

    it("comparison ternary is valid", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(n:number)
                -> { actionName: "test", count: n > 0 ? n : 0, label: "x", active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(0);
    });

    it("typeof is valid with any operand", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)
                -> { actionName: "test", count: 0, label: typeof name, active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(0);
    });

    it("=== accepts any types", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)
                -> { actionName: "test", count: 0, label: "x", active: name === "hello" };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(0);
    });

    it("resolveType handles circular type-reference chains", () => {
        // Create a mutually-recursive grammar where <A> → <B> → <A>.
        // Type derivation must not hang or throw, and validation should
        // complete gracefully.
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(level:<A>)
                -> { actionName: "test", count: 0, label: level, active: true };
            <A> = $(x:string) | recurse $(y:<B>);
            <B> = $(x:string) | recurse $(y:<A>);
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        // The important thing is that this does not hang.
        // The recursive rules produce string, which matches the label field.
        expect(errors.length).toBe(0);
    });

    it("resolveType handles 3-way circular type-reference chains", () => {
        // Three-way cycle: <A> → <B> → <C> → <A>
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(level:<A>)
                -> { actionName: "test", count: 0, label: level, active: true };
            <A> = $(x:string) | next $(y:<B>);
            <B> = $(x:string) | next $(y:<C>);
            <C> = $(x:string) | next $(y:<A>);
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(0);
    });

    it("resolveType handles self-referencing rule", () => {
        // Direct self-reference: <A> → <A>
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(level:<A>)
                -> { actionName: "test", count: 0, label: level, active: true };
            <A> = $(x:string) | next $(y:<A>);
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(0);
    });

    it("string.slice with string arg produces error", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)
                -> { actionName: "test", count: 0, label: name.slice("x"), active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0]).toContain("slice");
        expect(errors[0]).toContain("number");
    });

    it("string.indexOf with number first arg produces error", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(n:number)
                -> { actionName: "test", count: 0, label: "x", active: "hello".indexOf(n) > 0 };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0]).toContain("indexOf");
        expect(errors[0]).toContain("string");
    });

    it("string.padStart with correct args is valid", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)
                -> { actionName: "test", count: 0, label: name.padStart(10, "0"), active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(0);
    });

    it("number.toFixed with string arg produces error", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(n:number)
                -> { actionName: "test", count: 0, label: n.toFixed("2"), active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0]).toContain("toFixed");
        expect(errors[0]).toContain("number");
    });

    it("array.join with number arg produces error", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(n:number)
                -> { actionName: "test", count: 0, label: ["a", "b"].join(n), active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0]).toContain("join");
        expect(errors[0]).toContain("string");
    });

    it("unnecessary ?? emits warning", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)
                -> { actionName: "test", count: 0, label: name ?? "default", active: true };
        `;
        const errors: string[] = [];
        const warnings: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            warnings,
            exprOpts,
        );
        expect(errors.length).toBe(0);
        expect(warnings.length).toBeGreaterThan(0);
        expect(warnings[0]).toContain("??");
        expect(warnings[0]).toContain("unnecessary");
    });

    it("unnecessary ?. emits warning", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)
                -> { actionName: "test", count: name?.length ?? 0, label: "x", active: true };
        `;
        const errors: string[] = [];
        const warnings: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            warnings,
            exprOpts,
        );
        expect(errors.length).toBe(0);
        expect(warnings.length).toBeGreaterThan(0);
        expect(warnings.some((w) => w.includes("?."))).toBe(true);
        expect(warnings.some((w) => w.includes("unnecessary"))).toBe(true);
    });

    it("?. on type that is always undefined emits warning", () => {
        // Create a schema with an optional field (T | undefined)
        const OptActionDef = SchemaCreator.intf(
            "OptAction",
            SchemaCreator.obj({
                actionName: SchemaCreator.field(SchemaCreator.string("test")),
                label: SchemaCreator.field(SchemaCreator.string()),
            }),
            undefined,
            true,
        );
        const optLoader: SchemaLoader = (typeName) =>
            typeName === "OptAction" ? OptActionDef : undefined;
        const grammarText = `
            import { OptAction } from "schema.ts";
            <Start> : OptAction = test $(name:string)?
                -> { actionName: "test", label: name?.toLowerCase() ?? "none" };
        `;
        const errors: string[] = [];
        const warnings: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, warnings, {
            schemaLoader: optLoader,
            enableValueExpressions: true,
        });
        expect(errors.length).toBe(0);
        // name is string | undefined, so ?. is legitimate
        // name?.toLowerCase() returns string | undefined, so ?? is legitimate
        // No warnings expected here — both operators are necessary
        expect(warnings.length).toBe(0);
    });

    it("warnings are collected alongside inference errors", () => {
        // unknown_var produces an inference error, but the unnecessary ??
        // on the label field should still produce a warning.
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)
                -> { actionName: "test", count: unknown_var + 1, label: name ?? "default", active: true };
        `;
        const errors: string[] = [];
        const warnings: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            warnings,
            exprOpts,
        );
        // Inference error for unknown_var
        expect(errors.some((e) => e.includes("unknown_var"))).toBe(true);
        // Warning for unnecessary ?? — name is string, never undefined
        expect(
            warnings.some((w) => w.includes("??") && w.includes("unnecessary")),
        ).toBe(true);
    });
});

// ── Structural conformance for expression results ─────────────────────────────
// Verify that expression results are validated structurally against the
// expected type, not just by type discriminant.  Previously, the expression
// branch used the shallow `isTypeAssignable` which would accept `string[]`
// for `number[]` because both are "array".

describe("expression structural conformance", () => {
    it("split() result (string[]) rejected for number[] field", () => {
        const ArrayActionDef = SchemaCreator.intf(
            "ArrayAction",
            SchemaCreator.obj({
                actionName: SchemaCreator.field(SchemaCreator.string("act")),
                items: SchemaCreator.field(
                    SchemaCreator.array(SchemaCreator.number()),
                ),
            }),
            undefined,
            true,
        );
        const loader: SchemaLoader = (typeName) =>
            typeName === "ArrayAction" ? ArrayActionDef : undefined;
        const grammarText = `
            import { ArrayAction } from "schema.ts";
            <Start> : ArrayAction = test $(s:string)
                -> { actionName: "act", items: s.split(",") };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: loader,
            enableValueExpressions: true,
        });
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain("number");
        expect(errors[0]).toContain("string");
    });

    it("split() result (string[]) accepted for string[] field", () => {
        const ArrayActionDef = SchemaCreator.intf(
            "ArrayAction",
            SchemaCreator.obj({
                actionName: SchemaCreator.field(SchemaCreator.string("act")),
                items: SchemaCreator.field(
                    SchemaCreator.array(SchemaCreator.string()),
                ),
            }),
            undefined,
            true,
        );
        const loader: SchemaLoader = (typeName) =>
            typeName === "ArrayAction" ? ArrayActionDef : undefined;
        const grammarText = `
            import { ArrayAction } from "schema.ts";
            <Start> : ArrayAction = test $(s:string)
                -> { actionName: "act", items: s.split(",") };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: loader,
            enableValueExpressions: true,
        });
        expect(errors.length).toBe(0);
    });

    it("comparison expression (boolean) rejected for string field", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(n:number)
                -> { actionName: "test", count: 0, label: n > 5, active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain("string");
        expect(errors[0]).toContain("boolean");
    });

    it("arithmetic expression (number) rejected for boolean field", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(n:number)
                -> { actionName: "test", count: 0, label: "x", active: n + 1 };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain("boolean");
        expect(errors[0]).toContain("number");
    });

    it("ternary producing number rejected for string field", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(n:number)
                -> { actionName: "test", count: 0, label: n > 0 ? 1 : 2, active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain("string");
        expect(errors[0]).toContain("number");
    });

    it("ternary producing string accepted for string field", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(n:number)
                -> { actionName: "test", count: 0, label: n > 0 ? "yes" : "no", active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(0);
    });

    it("optional capture without ?? rejected for required field", () => {
        // $(name:string)? produces string | undefined, which should not
        // pass for a required string field without a ?? fallback.
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)?
                -> { actionName: "test", count: 0, label: name, active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain("undefined");
    });

    it("optional capture with ?? fallback accepted for required field", () => {
        const grammarText = `
            import { ExprAction } from "schema.ts";
            <Start> : ExprAction = test $(name:string)?
                -> { actionName: "test", count: 0, label: name ?? "default", active: true };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow(
            "test",
            grammarText,
            errors,
            undefined,
            exprOpts,
        );
        expect(errors.length).toBe(0);
    });

    it("optional capture accepted for optional field", () => {
        const OptActionDef = SchemaCreator.intf(
            "OptAction",
            SchemaCreator.obj({
                actionName: SchemaCreator.field(SchemaCreator.string("test")),
                label: SchemaCreator.optional(SchemaCreator.string()),
            }),
            undefined,
            true,
        );
        const loader: SchemaLoader = (typeName) =>
            typeName === "OptAction" ? OptActionDef : undefined;
        const grammarText = `
            import { OptAction } from "schema.ts";
            <Start> : OptAction = test $(name:string)?
                -> { actionName: "test", label: name };
        `;
        const errors: string[] = [];
        loadGrammarRulesNoThrow("test", grammarText, errors, undefined, {
            schemaLoader: loader,
            enableValueExpressions: true,
        });
        expect(errors.length).toBe(0);
    });
});
