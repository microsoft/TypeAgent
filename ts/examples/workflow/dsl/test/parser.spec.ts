// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { lex } from "../src/lexer.js";
import { Parser } from "../src/parser.js";
import {
    WorkflowDecl,
    Expr,
    ConstStatement,
    IfStatement,
    SwitchStatement,
    ReturnStatement,
    ThrowStatement,
    DestructuringConst,
} from "../src/ast.js";

function parse(source: string) {
    const { tokens, errors: lexErrors } = lex(source);
    expect(lexErrors).toEqual([]);
    const parser = new Parser(tokens);
    return parser.parseSingle();
}

function parseExpr(source: string): Expr {
    // Wrap in a workflow so we get a valid parse context
    const wf = `workflow test(x: string): string { const r = ${source}; return r; }`;
    const { ast, errors } = parse(wf);
    expect(errors).toEqual([]);
    expect(ast).toBeDefined();
    const body = ast!.body;
    const first = body[0] as ConstStatement;
    return first.value;
}

function parseWf(source: string): WorkflowDecl {
    const { ast, errors } = parse(source);
    expect(errors).toEqual([]);
    expect(ast).toBeDefined();
    return ast!;
}

describe("parser", () => {
    // ---- Workflow structure ----

    test("parses empty workflow", () => {
        const wf = parseWf("workflow empty(x: string): string {}");
        expect(wf.name).toBe("empty");
        expect(wf.params).toHaveLength(1);
        expect(wf.params[0].name).toBe("x");
        expect(wf.returnType.kind).toBe("NamedType");
        expect(wf.body).toEqual([]);
    });

    test("parses workflow with multiple params", () => {
        const wf = parseWf(
            "workflow multi(a: string, b: number, c: boolean): unknown {}",
        );
        expect(wf.params).toHaveLength(3);
        expect(wf.params.map((p) => p.name)).toEqual(["a", "b", "c"]);
    });

    test("parses array return type", () => {
        const wf = parseWf("workflow arr(): string[] {}");
        expect(wf.returnType.kind).toBe("ArrayType");
        if (wf.returnType.kind === "ArrayType") {
            expect(wf.returnType.element.kind).toBe("NamedType");
        }
    });

    test("parses object return type", () => {
        const wf = parseWf("workflow obj(): { name: string, age: number } {}");
        expect(wf.returnType.kind).toBe("ObjectType");
        if (wf.returnType.kind === "ObjectType") {
            expect(wf.returnType.fields).toHaveLength(2);
        }
    });

    test("parses optional fields in object types", () => {
        const wf = parseWf(
            "workflow obj(): { name: string, desc?: string } {}",
        );
        if (wf.returnType.kind === "ObjectType") {
            expect(wf.returnType.fields[1].optional).toBe(true);
        }
    });

    // ---- Const statement ----

    test("const with type annotation", () => {
        const wf = parseWf(`
            workflow test(): string {
                const x: number = 42
                return x
            }
        `);
        const s = wf.body[0] as ConstStatement;
        expect(s.kind).toBe("ConstStatement");
        expect(s.name).toBe("x");
        expect(s.typeAnnotation).toBeDefined();
        expect(s.value.kind).toBe("NumberLiteralExpr");
    });

    test("const without type annotation", () => {
        const wf = parseWf(`
            workflow test(): string {
                const x = "hello"
                return x
            }
        `);
        const s = wf.body[0] as ConstStatement;
        expect(s.kind).toBe("ConstStatement");
        expect(s.typeAnnotation).toBeUndefined();
    });

    test("optional semicolons", () => {
        const wf = parseWf(`
            workflow test(): string {
                const a = 1;
                const b = 2
                return b
            }
        `);
        expect(wf.body).toHaveLength(3);
    });

    // ---- Destructuring const ----

    test("destructuring const", () => {
        const wf = parseWf(`
            workflow test(): string {
                const [a, b, c] = someCall()
                return a
            }
        `);
        const s = wf.body[0] as DestructuringConst;
        expect(s.kind).toBe("DestructuringConst");
        expect(s.names).toEqual(["a", "b", "c"]);
    });

    // ---- If statement ----

    test("if/else", () => {
        const wf = parseWf(`
            workflow test(x: boolean): string {
                if (x) {
                    return "yes"
                } else {
                    return "no"
                }
            }
        `);
        const s = wf.body[0] as IfStatement;
        expect(s.kind).toBe("IfStatement");
        expect(s.then).toHaveLength(1);
        expect(s.else_).toHaveLength(1);
    });

    test("if without else", () => {
        const wf = parseWf(`
            workflow test(x: boolean): string {
                if (x) {
                    return "yes"
                }
                return "no"
            }
        `);
        const s = wf.body[0] as IfStatement;
        expect(s.kind).toBe("IfStatement");
        expect(s.else_).toBeUndefined();
    });

    test("else if chain", () => {
        const wf = parseWf(`
            workflow test(x: number): string {
                if (x === 1) {
                    return "one"
                } else if (x === 2) {
                    return "two"
                } else {
                    return "other"
                }
            }
        `);
        const s = wf.body[0] as IfStatement;
        expect(s.kind).toBe("IfStatement");
        expect(s.else_).toHaveLength(1);
        expect(s.else_![0].kind).toBe("IfStatement");
    });

    // ---- Switch statement ----

    test("switch with cases and default", () => {
        const wf = parseWf(`
            workflow test(x: string): string {
                switch (x) {
                    case "a":
                        return "alpha"
                    case "b":
                        return "beta"
                    default:
                        return "other"
                }
            }
        `);
        const s = wf.body[0] as SwitchStatement;
        expect(s.kind).toBe("SwitchStatement");
        expect(s.arms).toHaveLength(2);
        expect(s.default_).toHaveLength(1);
    });

    test("switch without default", () => {
        const wf = parseWf(`
            workflow test(x: number): string {
                switch (x) {
                    case 1:
                        return "one"
                    case 2:
                        return "two"
                }
                return "unknown"
            }
        `);
        const s = wf.body[0] as SwitchStatement;
        expect(s.kind).toBe("SwitchStatement");
        expect(s.arms).toHaveLength(2);
        expect(s.default_).toBeUndefined();
    });

    test("switch case with break", () => {
        const wf = parseWf(`
            workflow test(x: string): string {
                switch (x) {
                    case "a":
                        const r = task.do()
                        break
                    default:
                        break
                }
                return "done"
            }
        `);
        const s = wf.body[0] as SwitchStatement;
        expect(s.arms[0].body).toHaveLength(2);
        expect(s.arms[0].body[1].kind).toBe("BreakStatement");
    });

    // ---- Return, break, throw ----

    test("return statement", () => {
        const wf = parseWf(`
            workflow test(): string {
                return "hello"
            }
        `);
        const s = wf.body[0] as ReturnStatement;
        expect(s.kind).toBe("ReturnStatement");
        expect(s.value.kind).toBe("StringLiteralExpr");
    });

    test("throw statement", () => {
        const wf = parseWf(`
            workflow test(): string {
                throw "error message"
            }
        `);
        const s = wf.body[0] as ThrowStatement;
        expect(s.kind).toBe("ThrowStatement");
        expect(s.value.kind).toBe("StringLiteralExpr");
    });

    test("break statement", () => {
        const wf = parseWf(`
            workflow test(x: string): string {
                switch (x) {
                    case "a":
                        break
                }
                return "done"
            }
        `);
        const s = wf.body[0] as SwitchStatement;
        expect(s.arms[0].body[0].kind).toBe("BreakStatement");
    });

    test("break outside switch produces error", () => {
        const { errors } = parse(`
            workflow test(): string {
                break
                return "done"
            }
        `);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].message).toContain("only allowed inside switch");
    });

    // ---- Expression: literals ----

    test("string literal", () => {
        const e = parseExpr('"hello"');
        expect(e.kind).toBe("StringLiteralExpr");
        if (e.kind === "StringLiteralExpr") expect(e.value).toBe("hello");
    });

    test("number literal", () => {
        const e = parseExpr("42");
        expect(e.kind).toBe("NumberLiteralExpr");
        if (e.kind === "NumberLiteralExpr") expect(e.value).toBe(42);
    });

    test("boolean literal", () => {
        const e = parseExpr("true");
        expect(e.kind).toBe("BooleanLiteralExpr");
        if (e.kind === "BooleanLiteralExpr") expect(e.value).toBe(true);
    });

    test("null literal", () => {
        const e = parseExpr("null");
        expect(e.kind).toBe("NullLiteralExpr");
    });

    test("array literal", () => {
        const e = parseExpr("[1, 2, 3]");
        expect(e.kind).toBe("ArrayLiteralExpr");
        if (e.kind === "ArrayLiteralExpr") expect(e.elements).toHaveLength(3);
    });

    test("object literal", () => {
        const e = parseExpr('{ name: "test", value: 42 }');
        expect(e.kind).toBe("ObjectLiteralExpr");
        if (e.kind === "ObjectLiteralExpr") {
            expect(e.entries).toHaveLength(2);
            expect(e.entries[0].key).toBe("name");
        }
    });

    test("object literal with shorthand", () => {
        const e = parseExpr("{ name, value }");
        expect(e.kind).toBe("ObjectLiteralExpr");
        if (e.kind === "ObjectLiteralExpr") {
            expect(e.entries).toHaveLength(2);
            // Shorthand: { name } -> { name: name }
            expect(e.entries[0].value.kind).toBe("DottedNameExpr");
        }
    });

    test("template literal with interpolation", () => {
        const e = parseExpr("`hello ${name}!`");
        expect(e.kind).toBe("TemplateLiteralExpr");
        if (e.kind === "TemplateLiteralExpr") {
            expect(e.parts).toEqual(["hello ", "!"]);
            expect(e.expressions).toHaveLength(1);
        }
    });

    test("template literal without interpolation", () => {
        const e = parseExpr("`plain text`");
        expect(e.kind).toBe("StringLiteralExpr");
    });

    // ---- Expression: binary operators ----

    test("=== comparison", () => {
        const e = parseExpr("a === b");
        expect(e.kind).toBe("BinaryExpr");
        if (e.kind === "BinaryExpr") {
            expect(e.op).toBe("===");
        }
    });

    test("!== comparison", () => {
        const e = parseExpr("a !== b");
        expect(e.kind).toBe("BinaryExpr");
        if (e.kind === "BinaryExpr") {
            expect(e.op).toBe("!==");
        }
    });

    test("comparison operators", () => {
        for (const op of [">", "<", ">=", "<="]) {
            const e = parseExpr(`a ${op} b`);
            expect(e.kind).toBe("BinaryExpr");
            if (e.kind === "BinaryExpr") {
                expect(e.op).toBe(op);
            }
        }
    });

    test("arithmetic operators", () => {
        for (const op of ["+", "-", "*", "/", "%"]) {
            const e = parseExpr(`a ${op} b`);
            expect(e.kind).toBe("BinaryExpr");
            if (e.kind === "BinaryExpr") {
                expect(e.op).toBe(op);
            }
        }
    });

    test("logical && and ||", () => {
        const e = parseExpr("a && b || c");
        // || has lower precedence than &&
        expect(e.kind).toBe("BinaryExpr");
        if (e.kind === "BinaryExpr") {
            expect(e.op).toBe("||");
            expect(e.left.kind).toBe("BinaryExpr");
            if (e.left.kind === "BinaryExpr") {
                expect(e.left.op).toBe("&&");
            }
        }
    });

    test("arithmetic precedence: * before +", () => {
        const e = parseExpr("a + b * c");
        expect(e.kind).toBe("BinaryExpr");
        if (e.kind === "BinaryExpr") {
            expect(e.op).toBe("+");
            expect(e.right.kind).toBe("BinaryExpr");
            if (e.right.kind === "BinaryExpr") {
                expect(e.right.op).toBe("*");
            }
        }
    });

    // ---- Expression: unary ----

    test("logical not", () => {
        const e = parseExpr("!x");
        expect(e.kind).toBe("UnaryExpr");
        if (e.kind === "UnaryExpr") {
            expect(e.op).toBe("!");
            expect(e.operand.kind).toBe("DottedNameExpr");
        }
    });

    test("unary minus", () => {
        const e = parseExpr("-x");
        expect(e.kind).toBe("UnaryExpr");
        if (e.kind === "UnaryExpr") {
            expect(e.op).toBe("-");
        }
    });

    // ---- Expression: ternary ----

    test("ternary expression", () => {
        const e = parseExpr('x ? "yes" : "no"');
        expect(e.kind).toBe("TernaryExpr");
        if (e.kind === "TernaryExpr") {
            expect(e.condition.kind).toBe("DottedNameExpr");
            expect(e.consequent.kind).toBe("StringLiteralExpr");
            expect(e.alternate.kind).toBe("StringLiteralExpr");
        }
    });

    // ---- Expression: task call ----

    test("dotted task call with named args", () => {
        const e = parseExpr('text.template(template: "hello", vars: {})');
        expect(e.kind).toBe("TaskCallExpr");
        if (e.kind === "TaskCallExpr") {
            expect(e.task).toBe("text.template");
            expect(e.args).toHaveLength(2);
            expect(e.args[0].kind).toBe("NamedArg");
        }
    });

    test("dotted task call with positional args", () => {
        const e = parseExpr('shell.exec("ls")');
        expect(e.kind).toBe("TaskCallExpr");
        if (e.kind === "TaskCallExpr") {
            expect(e.task).toBe("shell.exec");
            expect(e.args).toHaveLength(1);
            expect(e.args[0].kind).toBe("PositionalArg");
        }
    });

    test("dotted name without call", () => {
        const e = parseExpr("result.stdout");
        expect(e.kind).toBe("DottedNameExpr");
        if (e.kind === "DottedNameExpr") {
            expect(e.segments).toEqual(["result", "stdout"]);
        }
    });

    // ---- Expression: workflow call ----

    test("workflow call (single-segment name)", () => {
        const e = parseExpr('subWorkflow("arg1")');
        expect(e.kind).toBe("WorkflowCallExpr");
        if (e.kind === "WorkflowCallExpr") {
            expect(e.name).toBe("subWorkflow");
            expect(e.args).toHaveLength(1);
        }
    });

    // ---- Expression: built-in functions ----

    test("retry builtin", () => {
        const e = parseExpr('retry(3, () => { return task.call("x") })');
        expect(e.kind).toBe("RetryNode");
        if (e.kind === "RetryNode") {
            expect(e.count.kind).toBe("NumberLiteralExpr");
            expect(e.body).toHaveLength(1);
        }
    });

    test("retry builtin with fallback", () => {
        const e = parseExpr(
            'retry(3, () => { return task.call("x") }, (err) => { return "fallback" })',
        );
        expect(e.kind).toBe("RetryNode");
        if (e.kind === "RetryNode") {
            expect(e.fallback).toBeDefined();
            expect(e.fallback!.param).toBe("err");
        }
    });

    test("map builtin", () => {
        const e = parseExpr(
            "map(items, (item) => { return task.process(data: item) })",
        );
        expect(e.kind).toBe("MapNode");
        if (e.kind === "MapNode") {
            expect(e.param).toBe("item");
            expect(e.body).toHaveLength(1);
        }
    });

    test("filter builtin", () => {
        const e = parseExpr(
            "filter(items, (item) => { return item.valid === true })",
        );
        expect(e.kind).toBe("FilterNode");
        if (e.kind === "FilterNode") {
            expect(e.param).toBe("item");
        }
    });

    test("parallel builtin", () => {
        const e = parseExpr(
            'parallel(() => { return task.a("x") }, () => { return task.b("y") })',
        );
        expect(e.kind).toBe("ParallelNode");
        if (e.kind === "ParallelNode") {
            expect(e.bodies).toHaveLength(2);
        }
    });

    test("parallelMap builtin", () => {
        const e = parseExpr(
            "parallelMap(items, (item) => { return task.process(data: item) })",
        );
        expect(e.kind).toBe("ParallelMapNode");
        if (e.kind === "ParallelMapNode") {
            expect(e.param).toBe("item");
        }
    });

    test("parallel with maxConcurrency", () => {
        const e = parseExpr(
            'parallel(() => { return task.a("x") }, { maxConcurrency: 2 })',
        );
        expect(e.kind).toBe("ParallelNode");
        if (e.kind === "ParallelNode") {
            expect(e.maxConcurrency).toBeDefined();
        }
    });

    test("parallelMap with maxConcurrency", () => {
        const e = parseExpr(
            "parallelMap(items, (item) => { return task.process(data: item) }, { maxConcurrency: 5 })",
        );
        expect(e.kind).toBe("ParallelMapNode");
        if (e.kind === "ParallelMapNode") {
            expect(e.maxConcurrency).toBeDefined();
        }
    });

    // ---- Expression: parenthesized ----

    test("parenthesized expression", () => {
        const e = parseExpr("(42)");
        expect(e.kind).toBe("NumberLiteralExpr");
    });

    // ---- Parse multi-workflow ----

    test("parse() returns multiple workflows", () => {
        const source = `
            workflow a(): string { return "a" }
            workflow b(): string { return "b" }
        `;
        const { tokens } = lex(source);
        const parser = new Parser(tokens);
        const { workflows, errors } = parser.parse();
        expect(errors).toEqual([]);
        expect(workflows).toHaveLength(2);
        expect(workflows[0].name).toBe("a");
        expect(workflows[1].name).toBe("b");
    });

    // ---- Error cases ----

    test("error on unexpected token", () => {
        const source = "workflow test(): string { ??? }";
        const { tokens } = lex(source);
        const parser = new Parser(tokens);
        const { errors } = parser.parseSingle();
        expect(errors.length).toBeGreaterThan(0);
    });

    // ---- Expression statement (bare call) ----

    test("bare task call as expression statement", () => {
        const wf = parseWf(`
            workflow test(): string {
                audit.log("something")
                return "done"
            }
        `);
        // Bare call wrapped as ConstStatement with synthetic name
        expect(wf.body).toHaveLength(2);
        expect(wf.body[0].kind).toBe("ConstStatement");
    });

    // ---- Comprehensive workflow ----

    test("complex workflow parses without errors", () => {
        const source = `
            workflow processData(input: { items: string[], threshold: number }): { results: string[], count: number } {
                const filtered = filter(input.items, (item) => {
                    return item !== null
                })

                const results = parallelMap(filtered, (item) => {
                    const processed = text.template(template: \`Processing: \${item}\`, vars: {})
                    return processed
                }, { maxConcurrency: 3 })

                if (results === null) {
                    throw "Processing failed"
                }

                return { results, count: 42 }
            }
        `;
        const { ast, errors } = parse(source);
        expect(errors).toEqual([]);
        expect(ast).toBeDefined();
        expect(ast!.name).toBe("processData");
    });
});
