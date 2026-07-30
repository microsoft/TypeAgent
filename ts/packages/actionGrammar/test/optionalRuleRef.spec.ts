// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Bare quantifiers on rule references: <Name>?, <Name>*, <Name>+
 *
 * Previously "?" after a rule ref was parsed as a literal string part, so
 * `show <Owner>? files` failed to match `show files` while the grouped form
 * `show (<Owner>)? files` worked. This suite locks the parse/compile/match
 * behavior for bare optional/star/plus rule refs.
 */
import { parseGrammarRules } from "../src/grammarRuleParser.js";
import { loadGrammarRules } from "../src/grammarLoader.js";
import { writeGrammarRules } from "../src/grammarRuleWriter.js";
import { describeForEachMatcher } from "./testUtils.js";

function defNamed(ast: ReturnType<typeof parseGrammarRules>, name: string) {
    return ast.definitions.find((d) => d.definitionName.name === name)!;
}

describe("Bare optional / star / plus rule references", () => {
    it("parses <Owner>? as optional ruleReference (not a literal '?')", () => {
        const ast = parseGrammarRules(
            "test.agr",
            `
            <Owner> = alice | bob;
            <Start> = show <Owner>? files -> true;
            `,
            false,
        );
        const exprs = defNamed(ast, "Start").rules[0].expressions;
        expect(exprs.map((e) => e.type)).toEqual([
            "string",
            "ruleReference",
            "string",
        ]);
        const ref = exprs[1] as {
            type: "ruleReference";
            optional?: boolean;
            repeat?: boolean;
            refName: { name: string };
        };
        expect(ref.refName.name).toBe("Owner");
        expect(ref.optional).toBe(true);
        expect(ref.repeat).toBeUndefined();
    });

    it("parses <Owner>* and <Owner>+ with repeat flags", () => {
        const star = parseGrammarRules(
            "test.agr",
            `<Owner> = a; <Start> = x <Owner>* y -> true;`,
            false,
        );
        const starRef = defNamed(star, "Start").rules[0].expressions[1] as {
            optional?: boolean;
            repeat?: boolean;
        };
        expect(starRef.optional).toBe(true);
        expect(starRef.repeat).toBe(true);

        const plus = parseGrammarRules(
            "test.agr",
            `<Owner> = a; <Start> = x <Owner>+ y -> true;`,
            false,
        );
        const plusRef = defNamed(plus, "Start").rules[0].expressions[1] as {
            optional?: boolean;
            repeat?: boolean;
        };
        expect(plusRef.optional).toBeUndefined();
        expect(plusRef.repeat).toBe(true);
    });

    it("round-trips bare optional / star / plus rule refs through the writer", () => {
        const src = `
            <Owner> = alice | bob;
            <Opt> = show <Owner>? files -> "opt";
            <Star> = show <Owner>* files -> "star";
            <Plus> = show <Owner>+ files -> "plus";
        `;
        const ast = parseGrammarRules("test.agr", src, false);
        const written = writeGrammarRules(ast);
        const reparsed = parseGrammarRules("roundtrip.agr", written, false);
        const getRef = (name: string) =>
            defNamed(reparsed, name).rules[0].expressions[1] as {
                type: string;
                optional?: boolean;
                repeat?: boolean;
            };
        expect(getRef("Opt")).toMatchObject({
            type: "ruleReference",
            optional: true,
        });
        expect(getRef("Star")).toMatchObject({
            type: "ruleReference",
            optional: true,
            repeat: true,
        });
        expect(getRef("Plus")).toMatchObject({
            type: "ruleReference",
            repeat: true,
        });
        expect(getRef("Plus").optional).toBeFalsy();
    });
});

describeForEachMatcher(
    "Bare optional rule ref matching",
    (testMatchGrammar) => {
        const ownerGrammar = `
            <Owner> = alice | bob;
            <Start> = show <Owner>? files -> "bare";
        `;
        const groupedGrammar = `
            <Owner> = alice | bob;
            <Start> = show (<Owner>)? files -> "grouped";
        `;
        const requiredGrammar = `
            <Owner> = alice | bob;
            <Start> = show <Owner> files -> "required";
        `;

        it("matches without the optional owner (bare <Owner>?)", () => {
            const g = loadGrammarRules("test.agr", ownerGrammar);
            expect(testMatchGrammar(g, "show files")).toStrictEqual(["bare"]);
        });

        it("matches with the optional owner present (bare <Owner>?)", () => {
            const g = loadGrammarRules("test.agr", ownerGrammar);
            expect(testMatchGrammar(g, "show alice files")).toStrictEqual([
                "bare",
            ]);
            expect(testMatchGrammar(g, "show bob files")).toStrictEqual([
                "bare",
            ]);
        });

        it("bare <Owner>? is equivalent to grouped (<Owner>)?", () => {
            const bare = loadGrammarRules("bare.agr", ownerGrammar);
            const grouped = loadGrammarRules("grouped.agr", groupedGrammar);
            for (const input of [
                "show files",
                "show alice files",
                "show bob files",
            ]) {
                expect(testMatchGrammar(bare, input)).toStrictEqual(
                    testMatchGrammar(grouped, input).map(() => "bare"),
                );
                // grouped returns "grouped"; compare match success only
                expect(testMatchGrammar(bare, input).length).toBe(
                    testMatchGrammar(grouped, input).length,
                );
            }
        });

        it("required <Owner> still rejects missing owner", () => {
            const g = loadGrammarRules("test.agr", requiredGrammar);
            expect(testMatchGrammar(g, "show files")).toStrictEqual([]);
            expect(testMatchGrammar(g, "show alice files")).toStrictEqual([
                "required",
            ]);
        });

        it("bare <Owner>* matches zero or more owners", () => {
            const g = loadGrammarRules(
                "test.agr",
                `
                <Owner> = alice | bob;
                <Start> = show <Owner>* files -> "star";
                `,
            );
            expect(testMatchGrammar(g, "show files")).toStrictEqual(["star"]);
            expect(testMatchGrammar(g, "show alice files")).toStrictEqual([
                "star",
            ]);
            expect(testMatchGrammar(g, "show alice bob files")).toStrictEqual([
                "star",
            ]);
        });

        it("bare <Owner>+ requires at least one owner", () => {
            const g = loadGrammarRules(
                "test.agr",
                `
                <Owner> = alice | bob;
                <Start> = show <Owner>+ files -> "plus";
                `,
            );
            expect(testMatchGrammar(g, "show files")).toStrictEqual([]);
            expect(testMatchGrammar(g, "show alice files")).toStrictEqual([
                "plus",
            ]);
            expect(testMatchGrammar(g, "show alice bob files")).toStrictEqual([
                "plus",
            ]);
        });
    },
);
