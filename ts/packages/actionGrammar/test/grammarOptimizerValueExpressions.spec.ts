// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Coverage for the value-expression rewrite paths in
 * `substituteValueVariables` (inliner Substitute branch) and
 * `collectVariableReferences` (factorer cross-scope-ref check).
 *
 * Both walks recurse over every `CompiledValueNode` kind; the existing
 * optimizer specs only exercised `literal`, `variable`, and `object`.
 * The remaining node types (`array`, `binaryExpression`,
 * `unaryExpression`, `conditionalExpression`, `memberExpression`,
 * `callExpression`, `spreadElement`, `templateLiteral`, plus the object
 * `spread` element and the shorthand-with-substitution branch) are
 * exercised here.
 */

import { loadGrammarRules } from "../src/grammarLoader.js";
import { matchGrammar } from "../src/grammarMatcher.js";

function load(text: string, withOpt: boolean) {
    if (withOpt) {
        return loadGrammarRules("t.grammar", text, {
            enableValueExpressions: true,
            optimizations: {
                inlineSingleAlternatives: true,
                factorCommonPrefixes: true,
            },
        });
    }
    return loadGrammarRules("t.grammar", text, {
        enableValueExpressions: true,
    });
}

function match(grammar: ReturnType<typeof loadGrammarRules>, request: string) {
    return matchGrammar(grammar, request).map((m) => m.match);
}

function expectAgrees(text: string, inputs: string[]) {
    const baseline = load(text, false);
    const optimized = load(text, true);
    for (const input of inputs) {
        expect(match(optimized, input)).toStrictEqual(match(baseline, input));
    }
}

describe("Grammar Optimizer - Value expression rewrites (Substitute branch)", () => {
    // Each test sets up an inliner Substitute scenario:
    //   - <Inner> is a single-alternative wrapper with its own value
    //     expression — the inliner inlines its parts and substitutes
    //     <Inner>'s value for the parent's capture variable.
    //   - The parent has its own value expression that references the
    //     capture variable inside the node type under test.
    // After substitution, the matcher evaluates the rewritten parent
    // value and the result must match the unoptimized baseline.

    it("substitutes through array node", () => {
        const text = `<Start> = play $(t:<Inner>) here -> [t, "tail"];
<Inner> = $(name:string) -> name;`;
        expectAgrees(text, ["play hello here"]);
        expect(match(load(text, true), "play hello here")).toStrictEqual([
            ["hello", "tail"],
        ]);
    });

    it("substitutes through binaryExpression node", () => {
        const text = `<Start> = play $(t:<Inner>) here -> t + "_suffix";
<Inner> = $(name:string) -> name;`;
        expectAgrees(text, ["play hello here"]);
        expect(match(load(text, true), "play hello here")).toStrictEqual([
            "hello_suffix",
        ]);
    });

    it("substitutes through unaryExpression node", () => {
        const text = `<Start> = play $(t:<Inner>) here -> typeof t;
<Inner> = $(name:string) -> name;`;
        expectAgrees(text, ["play hello here"]);
        expect(match(load(text, true), "play hello here")).toStrictEqual([
            "string",
        ]);
    });

    it("substitutes through conditionalExpression node", () => {
        const text = `<Start> = play $(t:<Inner>) here -> t === "hi" ? "yes" : "no";
<Inner> = $(name:string) -> name;`;
        expectAgrees(text, ["play hi here", "play bye here"]);
        expect(match(load(text, true), "play hi here")).toStrictEqual(["yes"]);
        expect(match(load(text, true), "play bye here")).toStrictEqual(["no"]);
    });

    it("substitutes through memberExpression node (computed property)", () => {
        const text = `<Start> = play $(t:<Inner>) here -> t.length;
<Inner> = $(name:string) -> name;`;
        expectAgrees(text, ["play hello here"]);
        expect(match(load(text, true), "play hello here")).toStrictEqual([5]);
    });

    it("substitutes through memberExpression node (computed index)", () => {
        const text = `<Start> = play $(t:<Inner>) here -> t[0];
<Inner> = $(name:string) -> name;`;
        expectAgrees(text, ["play hello here"]);
        expect(match(load(text, true), "play hello here")).toStrictEqual(["h"]);
    });

    it("substitutes through callExpression node", () => {
        const text = `<Start> = play $(t:<Inner>) here -> t.toUpperCase();
<Inner> = $(name:string) -> name;`;
        expectAgrees(text, ["play hello here"]);
        expect(match(load(text, true), "play hello here")).toStrictEqual([
            "HELLO",
        ]);
    });

    it("substitutes through spreadElement (array spread)", () => {
        const text = `<Start> = play $(t:<Inner>) here -> [...t.split(" "), "tail"];
<Inner> = $(name:string) -> name;`;
        expectAgrees(text, ["play one two here"]);
        expect(match(load(text, true), "play one two here")).toStrictEqual([
            ["one", "two", "tail"],
        ]);
    });

    it("substitutes through templateLiteral node", () => {
        const text = `<Start> = play $(t:<Inner>) here -> \`hello \${t}!\`;
<Inner> = $(name:string) -> name;`;
        expectAgrees(text, ["play world here"]);
        expect(match(load(text, true), "play world here")).toStrictEqual([
            "hello world!",
        ]);
    });

    it("substitutes through object spread element", () => {
        // <Inner> produces an object; parent spreads it.
        const text = `<Start> = play $(t:<Inner>) here -> { ...t, extra: 1 };
<Inner> = $(name:string) -> { name };`;
        expectAgrees(text, ["play hello here"]);
        expect(match(load(text, true), "play hello here")).toStrictEqual([
            { name: "hello", extra: 1 },
        ]);
    });

    it("substitutes through object shorthand key (expands to {key: replacement})", () => {
        // Parent value uses shorthand `{ t }` — when `t` is the
        // captured variable, substituteValueVariables expands it to
        // `{ t: <child.value> }` so the field name stays `t`.
        const text = `<Start> = play $(t:<Inner>) here -> { t };
<Inner> = $(name:string) -> { who: name };`;
        expectAgrees(text, ["play hello here"]);
        expect(match(load(text, true), "play hello here")).toStrictEqual([
            { t: { who: "hello" } },
        ]);
    });
});

describe("Grammar Optimizer - Value expression walks (cross-scope-ref check)", () => {
    // Force the factorer's `cross-scope-ref` eligibility check to fire
    // by giving members a value expression that references the
    // canonical variable bound by the wrapper's prefix.  The check
    // walks each member's value via `collectVariableReferences`.
    //
    // The check returns "cross-scope-ref" when ANY member references a
    // prefix-bound canonical, forcing a bailout.  Even when no member
    // actually references a prefix canonical (the common case), the
    // walk still visits every node — exercising the recursion arms.

    function expectFactoringSafe(text: string, inputs: string[]) {
        const baseline = loadGrammarRules("t.grammar", text, {
            enableValueExpressions: true,
        });
        const optimized = loadGrammarRules("t.grammar", text, {
            enableValueExpressions: true,
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of inputs) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    }

    it("walks array, binary, ternary, member, call, spread, template node arms", () => {
        // Two alternatives share `play $(x:string) ` as a prefix — the
        // wrapper binds `x` (canonicalized).  Each member's value
        // exercises a different node kind referencing its own local
        // `y`, not `x`, so the cross-scope check finds no collision
        // (no bailout) but `collectVariableReferences` walks every
        // node arm.
        const text = `<Start> = <C>;
<C> = play $(x:string) once $(y:string) -> [y, y + "!", y === "hi" ? 1 : 2, y.length, y.toUpperCase(), ...y.split(""), \`<\${y}>\`]
    | play $(x:string) twice $(y:number) -> [-y, !y ? "z" : "nz", y > 0];`;
        expectFactoringSafe(text, [
            "play a once hi",
            "play a twice 5",
            "play a twice 0",
        ]);
    });

    it("walks object spread and shorthand value arms", () => {
        // Two alternatives share `play $(x:string) ` prefix; each
        // member's value contains object spread + shorthand
        // referencing local `y` — exercises the object/spread arm of
        // collectVariableReferences.
        const text = `<Base> = $(s:string) -> { s };
<Start> = <C>;
<C> = play $(x:string) once $(y:<Base>) -> { ...y, kind: "once" }
    | play $(x:string) twice $(y:<Base>) -> { y, kind: "twice" };`;
        expectFactoringSafe(text, ["play a once hi", "play a twice bye"]);
    });

    it("triggers cross-scope-ref bailout when member value references prefix binding", () => {
        // Both members' value expressions reference `x` which is the
        // shared-prefix wildcard.  Since `x` becomes a wrapper-scope
        // canonical that's invisible to the wrapped members at runtime,
        // the factorer must bail out to keep the binding in scope.
        const text = `<Start> = <C>;
<C> = play $(x:string) once -> { kind: "once", v: x }
    | play $(x:string) twice -> { kind: "twice", v: x };`;
        expectFactoringSafe(text, ["play hello once", "play hello twice"]);
    });
});
