// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    grammarToJson,
    loadGrammarRules,
    type Grammar,
    type GrammarJson,
    type GrammarMatchResult,
} from "@typeagent/action-grammar";
import {
    SkillGrammarIndex,
    type SkillGrammarRule,
    type SkillGrammarRuntime,
    type SkillIdentity,
} from "../src/index.js";

const skill: SkillIdentity = {
    scope: "builtin",
    origin: "@typeagent/player",
    name: "player",
};
const fakeGrammar = { rules: [], ruleArrays: [] } satisfies GrammarJson;

function result(match: unknown): GrammarMatchResult {
    return {
        match,
        matchedValueCount: 1,
        wildcardCharCount: 0,
        entityWildcardPropertyNames: [],
    };
}

function runtime(
    matches: Readonly<Record<string, readonly unknown[]>>,
): SkillGrammarRuntime {
    return {
        grammarFromJson: (grammar) => grammar as unknown as Grammar,
        matchGrammar: (_grammar, utterance) =>
            (matches[utterance] ?? []).map(result),
    };
}

function rule(
    id: string,
    source: SkillGrammarRule["source"] = "package",
): SkillGrammarRule {
    return {
        id,
        skill: { ...skill },
        skillRevision: "revision-1",
        schemaFingerprint: "schema-1",
        source,
        grammar: fakeGrammar,
    };
}

const validate = (_skill: SkillIdentity, _schema: string, value: unknown) => ({
    valid:
        typeof value === "object" &&
        value !== null &&
        "actionName" in value &&
        (value as { actionName: string }).actionName !== "stop",
    errors: ["invalid action"],
});

describe("SkillGrammarIndex", () => {
    it("returns explicit match, miss, ambiguous, and invalid outcomes", () => {
        const index = new SkillGrammarIndex(
            validate,
            runtime({
                pause: [{ actionName: "pause" }],
                ambiguous: [{ actionName: "pause" }, { actionName: "resume" }],
                invalid: [{ actionName: "stop" }],
            }),
        );
        const snapshot = index.buildSnapshot([rule("base")]);

        expect(index.match(snapshot.id, "pause").status).toBe("match");
        expect(index.match(snapshot.id, "missing")).toEqual({ status: "miss" });
        expect(index.match(snapshot.id, "ambiguous").status).toBe("ambiguous");
        expect(index.match(snapshot.id, "invalid")).toEqual(
            expect.objectContaining({
                status: "invalid",
                errors: ["invalid action"],
            }),
        );
    });

    it("deduplicates equivalent matches and applies source precedence", () => {
        const index = new SkillGrammarIndex(
            validate,
            runtime({ pause: [{ actionName: "pause" }] }),
        );
        const snapshot = index.buildSnapshot([
            rule("package", "package"),
            rule("generated", "generated"),
            rule("correction", "userCorrection"),
            rule("overlay", "contextOverlay"),
        ]);
        const outcome = index.match(snapshot.id, "pause");

        expect(outcome.status).toBe("match");
        if (outcome.status === "match") {
            expect(outcome.equivalentMatchCount).toBe(4);
            expect(outcome.candidate.ruleId).toBe("overlay");
        }
    });

    it("does not deduplicate equal values routed to different skills", () => {
        const index = new SkillGrammarIndex(
            validate,
            runtime({ pause: [{ actionName: "pause" }] }),
        );
        const snapshot = index.buildSnapshot([
            rule("player"),
            {
                ...rule("desktop"),
                skill: { ...skill, name: "desktop" },
            },
        ]);
        expect(index.match(snapshot.id, "pause").status).toBe("ambiguous");
    });

    it("creates stable immutable snapshots tied to revision and schema", () => {
        const index = new SkillGrammarIndex(validate, runtime({}));
        const mutableSkill = { ...skill };
        const source = { ...rule("base"), skill: mutableSkill };
        const snapshot = index.buildSnapshot([source], {
            createdAt: "2026-01-01T00:00:00.000Z",
        });
        mutableSkill.name = "changed";

        expect(snapshot.rules[0].skill.name).toBe("player");
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(index.buildSnapshot([rule("base")])).toBe(snapshot);
        expect(
            index.buildSnapshot([
                { ...rule("base"), schemaFingerprint: "schema-2" },
            ]).id,
        ).not.toBe(snapshot.id);
    });

    it.each([
        ["grammarOnly", "match", "grammar", 0],
        ["grammarOnly", "miss", "none", 0],
        ["grammarFirst", "match", "grammar", 0],
        ["grammarFirst", "miss", "fallback", 1],
        ["hybrid", "match", "grammar", 1],
        ["shadow", "match", "fallback", 1],
    ] as const)(
        "supports %s mode on a grammar %s",
        async (mode, utterance, selected, calls) => {
            const index = new SkillGrammarIndex(
                validate,
                runtime({ match: [{ actionName: "pause" }] }),
            );
            const snapshot = index.buildSnapshot([rule("base")]);
            let fallbackCalls = 0;
            const fallback = {
                route: async () => {
                    fallbackCalls++;
                    return [
                        { skill, value: { actionName: "resume" }, score: 1 },
                    ];
                },
            };
            const routed = await index.route(
                snapshot.id,
                utterance,
                mode,
                mode === "grammarOnly" ? undefined : fallback,
            );
            expect(routed.selected).toBe(selected);
            expect(fallbackCalls).toBe(calls);
        },
    );

    it("uses @typeagent/action-grammar directly outside the dispatcher", () => {
        const grammar = loadGrammarRules(
            "player.agr",
            `<Start> = pause the music -> { actionName: "pause" };`,
        );
        const index = new SkillGrammarIndex(validate);
        const snapshot = index.buildSnapshot([
            { ...rule("real"), grammar: grammarToJson(grammar) },
        ]);
        const outcome = index.match(snapshot.id, "pause the music");
        expect(outcome.status).toBe("match");
        if (outcome.status === "match") {
            expect(outcome.candidate.value).toEqual({ actionName: "pause" });
        }
    });
});
