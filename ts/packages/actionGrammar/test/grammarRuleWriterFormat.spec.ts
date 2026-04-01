// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseGrammarRules } from "../src/grammarRuleParser.js";
import { writeGrammarRules } from "../src/grammarRuleWriter.js";

// Parse src and write it back with given maxLineLength.
function fmt(src: string, maxLineLength?: number): string {
    return writeGrammarRules(
        parseGrammarRules("t", src, false),
        maxLineLength !== undefined ? { maxLineLength } : undefined,
    );
}

// Parse src, write it, re-parse, and check AST equality.
function roundTrip(src: string, maxLineLength?: number) {
    const orig = parseGrammarRules("orig", src, false);
    const written = fmt(src, maxLineLength);
    const reparsed = parseGrammarRules("reparsed", written, false);
    expect(reparsed).toStrictEqual(orig);
}

// ─── Comprehensive formatting exercise ────────────────────────────────────────
//
// A single grammar that touches every code path in writeGrammarRules:
//   - file-level leading + trailing comments
//   - source-less imports (entity declarations) with leading/trailing comments
//   - long source-less import list that breaks into block at narrow widths
//   - wildcard and named imports with leading/trailing comments
//   - long named import list that breaks into block at narrow widths
//   - all three non-default spacing annotations
//   - pre-annotation and name-trailing block/line comments
//   - every expression type: string, <ruleRef>, $(var), typed/rule-ref/optional vars, groups ()?/*/ +
//   - inline expression comments (line + block)
//   - every value type: string, bool, number, variable, {}, [], nested, shorthand key
//   - value leading/trailing comments (line + block)
//   - value-node comments on object properties and array elements
//   - object property comma-trailing // and /* */ comments
//   - object property key leading block comments
//   - array element comma-trailing // and /* */ comments (trailingComment)
//   - array/object trailing comma with block and line closingComments
//   - empty array/object with closingComments
//   - multi-alt with per-alt leading comments
//
// With maxLineLength=40 every broken layout mode is triggered:
//   rule 1: multi-alt breaks at |
//   rule 2: -> moves to new line
//   rule 3: object and array expand
//   rule 4: inline group breaks with | aligned to (
//   rule 5: expression-sequence and within-string-token word wrapping

const FULL_GRAMMAR = `\
// Copyright (c) Example.
// All formatting patterns in one grammar.

// entities section (source-less imports)
import { Artist, Album }; // known types
// long entity list (breaks at maxLineLength=40)
import { LongEntityAlpha, LongEntityBeta, LongEntityGamma };

// wildcard import
import * from "baseGrammar"; // base rules
// named import
import { PhraseA, PhraseB } from "phrases"; // helpers
// long named import (breaks at maxLineLength=40)
import { LongRuleAlpha, LongRuleBeta, LongRuleGamma } from "longRules";

// spacing annotations
<WithRequired> [spacing=required] = one two;
<WithOptional> /* before */ [spacing=optional] /* after */ = three four;
<WithNone> [spacing=none] = hello world;

// name-trailing comments
<NameBlock> /* blk */ = x;
<NameLine> // line
= y;

// pre-annotation comment
<PreAnn> /* pre */ [spacing=required] = z;

// expression types
<VarString> = hello $(name) world;
<VarNumber> = volume $(level: number) now;
<VarRuleRef> = play $(track:<TrackName>);
<VarOptional> = show $(filter: number)? results;
<TrackName> = <Simple>;
<Simple> = one two three;
<RuleRef> = start <Simple> end;
<GroupOpt> = (yes | no)? please;
<GroupStar> = (word)* stop;
<GroupPlus> = (phrase)+ done;
<ExprBlockComment> = hello /* mid */ world;
<ExprLineComment> = hello // comment
world;

// value types
<ValString> = greet -> "hello";
<ValBool> = enable -> true;
<ValNumber> = count -> -12.3e+2;
<ValVar> = $(x) go -> x;
<ValObjFlat> = foo -> { actionName: "foo", n: 1 };
<ValObjEmpty> = empty -> {};
<ValObjShorthand> = $(x) do -> { x };
<ValObjNested> = deep -> { a: { b: "v" }, c: [1, 2] };
<ValArrFlat> = list -> [1, 2, 3];
<ValArrEmpty> = none -> [];
<ValArrNested> = mix -> [{ a: 1 }, "b", true];

// nested broken: inner block forced to expand (key-aligned indentation)
<NestedArrBreaks> = x -> { items: [alpha, bravo, charlie] };
<NestedObjBreaks> = x -> { params: { first: "one", second: "two" } };
<ArrObjBreaks> = x -> [{ first: "one", second: "two", third: "three" }];
<ArrArrBreaks> = x -> [[alpha, bravo, charlie, delta]];
<DeepNested> = x -> { outer: { inner: [alpha, bravo, charlie] } };
<NestedBrokenCmt> = x -> { items: [
  "a", // item note
  "b"
] };

// value comments
<ValLeadingLine> = foo -> // before value
{ actionName: "bar" };
<ValLeadingBlock> = foo -> /* note */ { actionName: "bar" };
<ValTrailingLine> = foo -> { actionName: "bar" } // after
| baz -> { actionName: "qux" };
<ValTrailingBlock> = foo -> { actionName: "bar" } /* note */ | baz -> { actionName: "qux" };
<PropLeadingBlock> = foo -> { type: /* before */ "hi" };
<PropTrailingBlock> = foo -> { type: "hi" /* after */ };
<PropCommaTrailingLine> = foo -> {
  type: "hi", // trailing line
  count: 1
};
<PropCommaTrailingBlock> = foo -> {
  type: "hi", /* trailing block */
  count: 1
};
<PropKeyLeadingBlock> = foo -> { /* before key */ type: "hi" };
<ArrElemLeading> = foo -> [/* first */ "a", "b"];
<ArrElemTrailing> = foo -> ["a" /* trailing */, "b"];
<ArrCommaTrailingBlock> = foo -> [
  "a", /* after comma */
  "b"
];
<ArrCommaTrailingLine> = foo -> [
  "a", // after comma
  "b"
];
<ArrInnerBlock> = foo -> [
  "a",
  /* inner block */
];
<ArrInnerLine> = foo -> [
  "a",
  // inner line
];
<ArrTrailingCommaBlock> = foo -> [
  "a", /* trailing */
];
<ArrTrailingCommaLine> = foo -> [
  "a", // trailing
];
<ArrEmptyInner> = foo -> [
  /* empty array */
];
<ObjInnerBlock> = foo -> {
  type: "hi",
  /* inner block */
};
<ObjInnerLine> = foo -> {
  type: "hi",
  // inner line
};
<ObjTrailingCommaBlock> = foo -> {
  type: "hi", /* trailing */
};
<ObjTrailingCommaLine> = foo -> {
  type: "hi", // trailing
};
<ObjEmptyInner> = foo -> {
  /* empty object */
};

// multi-alt with per-alt leading comments
<MultiAlt> =
// first
first option here
// second
| second option here
| third; // rule trailing

// end of file
`;

// ─── Structural comment positions ─────────────────────────────────────────────
//
// Exercises comment preservation at every structural position where the BNF
// says "all whitespace and comments are skipped" but the parser was previously
// crashing or silently discarding them:
//
//   1. Import (source-less): afterImportComments, afterCloseBraceComments, per-name comments
//   2. Import: afterImportComments, afterCloseBraceComments, afterFromComments
//   3. Import wildcard: afterStarComments
//   4. Import name: leadingComments / trailingComment per name
//   5. Rule name: nameLeadingComments / nameTrailingComments (inside < >)
//   6. Spacing annotation: afterBracket / afterKey / afterEquals / afterValue
//   7. Explicit spacing=auto: stored as "auto", not folded away by writer
//   8. Variable $(: variableName.leadingComments (between $( and identifier)
//   9. Variable colon (string default type): colonComments preserved
//  10. Variable colon (non-string type): colonComments preserved
//  11. Variable rule-ref type: typeNameLeadingComments / typeNameTrailingComments
//  12. Inline rule reference: nameLeadingComments / nameTrailingComments
//  13. Variable plain type: trailing comment after type identifier

const STRUCTURAL_COMMENTS = `\
// Grammar exercising comment preservation at all structural positions.

// source-less import: per-name leading and trailing block comments
import { /* eL1 */ Artist /* eT1 */, /* eL2 */ Album };

// import: after-keyword, per-name leading/trailing, after-brace comments
import /* kw */ { /* nL1 */ PhraseA /* nT1 */, /* nL2 */ PhraseB /* nT2 */ } /* brace */ from "phrases";

// import wildcard: after-star comment
import * /* star */ from "baseGrammar";

// rule name: comments inside < >
</*nL*/NameCmt/*nR*/> = hello;

// annotation: comments at all four gaps inside [ spacing = value ]
<AnnCmt> [/*aL*/spacing/*aK*/=/*aV*/required/*aR*/] = world;

// explicit spacing=auto preserved (not folded away by writer)
<AutoSpaced> [spacing=auto] = test;

// variable: block comment between $( and the variable identifier
<VarParen> = $(/*dp*/x) go;

// variable: block comment after colon, before string type (implicit default)
<VarColonStr> = $(x:/*col*/string) go;

// variable: block comment after colon, before non-string type
<VarColonNum> = $(x:/*col*/number) go;

// variable: block comment after plain type name (trailing)
<VarPlainTypeCmt> = $(x:number/*tc*/) go;

// variable: block comments inside rule-ref type < >
<VarRuleRefCmt> = $(x:</*tL*/Inner/*tR*/>) go;
<Inner> = one;

// inline rule reference: block comments inside < >
<InlineRef> = start </*rL*/Other/*rR*/> end;
<Other> = two;
`;

describe("Structural comment positions", () => {
    it("output matches snapshot", () => {
        expect(fmt(STRUCTURAL_COMMENTS)).toMatchSnapshot();
    });

    it("formatter is idempotent", () => {
        const once = fmt(STRUCTURAL_COMMENTS);
        expect(fmt(once)).toBe(once);
    });

    it("round-trips AST", () => {
        roundTrip(STRUCTURAL_COMMENTS);
    });
});

describe("Comprehensive formatting exercise", () => {
    describe("default maxLineLength (80)", () => {
        it("output matches snapshot", () => {
            expect(fmt(FULL_GRAMMAR)).toMatchSnapshot();
        });

        it("formatter is idempotent", () => {
            const once = fmt(FULL_GRAMMAR);
            expect(fmt(once)).toBe(once);
        });

        it("round-trips AST", () => {
            roundTrip(FULL_GRAMMAR);
        });
    });

    describe("maxLineLength=40 (all broken modes)", () => {
        // At 40 chars every layout rule fires:
        //   rule 1: multi-alt breaks at |
        //   rule 2: -> breaks to new line
        //   rule 3: objects and arrays expand
        //   rule 4: inline groups break with | aligned to (
        //   rule 5: expression tokens and within-string words wrap
        it("output matches snapshot", () => {
            expect(fmt(FULL_GRAMMAR, 40)).toMatchSnapshot();
        });

        it("formatter is idempotent", () => {
            const once = fmt(FULL_GRAMMAR, 40);
            expect(fmt(once, 40)).toBe(once);
        });

        it("round-trips AST", () => {
            roundTrip(FULL_GRAMMAR, 40);
        });
    });
});
