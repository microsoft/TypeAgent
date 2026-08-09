// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    actionParameterSourceFingerprint,
    applyLlmAsAJudgeVerify,
    buildActionParametersGraderCatalog,
    buildActionParametersGraderEntry,
    canonicalizeParamSpec,
    classifyActionParameterFieldWithFallback,
    diffActionParametersGrader,
    GRADER_RULES_VERSION,
    isParamSpec,
    loadActionParametersGraderCatalogFile,
    mergeUnionParamSpecs,
    parameterRequiresLlmJudge,
    HARDCODE_RULE_IDS,
    renderSchemaType,
    schemaTypeToParamSpec,
    toRecommendedByActionVerifyMap,
    tryClassifyActionParameterFieldHardcode,
    tryReusePriorFieldGraderDecision,
    type ParamSpec,
} from "../src/translationBench/policy/index.js";
import {
    clearPackagedActionEligibilityPolicyCacheForTests,
    countEligibleTranslationBenchActions,
    getPackagedScheduleExcludedActionIds,
} from "../src/translationBench/synthesizer/eligibleActions.js";

function objectSpec(
    fields: Record<string, { optional: boolean; spec: ParamSpec }>,
): ParamSpec {
    return { kind: "object", fields };
}

/** TermFilter.timeRange AST: DateTimeRange | undefined → DateTime → DateVal/TimeVal. */
function termFilterTimeRangeAst() {
    const dateVal = {
        type: "type-reference" as const,
        name: "DateVal",
        definition: {
            name: "DateVal",
            type: {
                type: "object" as const,
                fields: {
                    day: { optional: false, type: { type: "number" as const } },
                    month: {
                        optional: false,
                        type: { type: "number" as const },
                    },
                    year: {
                        optional: false,
                        type: { type: "number" as const },
                    },
                },
            },
        },
    };
    const timeVal = {
        type: "type-reference" as const,
        name: "TimeVal",
        definition: {
            name: "TimeVal",
            type: {
                type: "object" as const,
                fields: {
                    hour: {
                        optional: false,
                        type: { type: "number" as const },
                    },
                    minute: {
                        optional: false,
                        type: { type: "number" as const },
                    },
                    seconds: {
                        optional: false,
                        type: { type: "number" as const },
                    },
                },
            },
        },
    };
    const dateTime = {
        type: "type-reference" as const,
        name: "DateTime",
        definition: {
            name: "DateTime",
            type: {
                type: "object" as const,
                fields: {
                    date: { optional: false, type: dateVal },
                    time: {
                        optional: true,
                        type: {
                            type: "type-union" as const,
                            types: [timeVal, { type: "undefined" as const }],
                        },
                    },
                },
            },
        },
    };
    const dateTimeRange = {
        type: "type-reference" as const,
        name: "DateTimeRange",
        definition: {
            name: "DateTimeRange",
            type: {
                type: "object" as const,
                fields: {
                    startDate: { optional: false, type: dateTime },
                    stopDate: {
                        optional: true,
                        type: {
                            type: "type-union" as const,
                            types: [dateTime, { type: "undefined" as const }],
                        },
                    },
                },
            },
        },
    };
    return {
        type: "object" as const,
        fields: {
            verbs: {
                optional: true,
                type: {
                    type: "array" as const,
                    elementType: { type: "string" as const },
                },
            },
            terms: {
                optional: false,
                type: {
                    type: "array" as const,
                    elementType: { type: "string" as const },
                },
            },
            timeRange: {
                optional: true,
                type: {
                    type: "type-union" as const,
                    types: [dateTimeRange, { type: "undefined" as const }],
                },
            },
        },
    };
}

describe("tryClassifyActionParameterFieldHardcode", () => {
    it("inherits element policy for arrays and loosens soft container verify", () => {
        expect(
            tryClassifyActionParameterFieldHardcode(
                "items",
                { kind: "array", item: { kind: "string" } },
                false,
            ),
        ).toMatchObject({
            create: "free_text",
            verify: "nonempty",
            rule: "array-items:string-collection-element-nonempty",
            item: { create: "free_text", verify: "nonempty" },
        });
    });

    it("keeps exact container verify for number[] (runner has no item loop)", () => {
        expect(
            tryClassifyActionParameterFieldHardcode(
                "selectedIndices",
                { kind: "array", item: { kind: "number" } },
                false,
            ),
        ).toMatchObject({
            create: "typed_literal",
            verify: "exact",
            rule: "array-items:type-number",
            item: { create: "typed_literal", verify: "exact" },
        });
    });

    it("matches scalar hand fixture policies", () => {
        expect(
            tryClassifyActionParameterFieldHardcode(
                "listName",
                { kind: "string" },
                false,
            ),
        ).toMatchObject({ create: "identifier", verify: "exact" });
        expect(
            tryClassifyActionParameterFieldHardcode(
                "description",
                { kind: "string" },
                false,
            ),
        ).toMatchObject({ create: "free_text", verify: "nonempty" });
        expect(
            tryClassifyActionParameterFieldHardcode(
                "date",
                { kind: "string" },
                false,
            ),
        ).toMatchObject({
            create: "temporal",
            verify: "nonempty",
            rule: "string-date-nonempty",
        });
        expect(
            tryClassifyActionParameterFieldHardcode(
                "time",
                { kind: "string" },
                true,
            ),
        ).toMatchObject({ create: "temporal", verify: "nonempty" });
        expect(
            tryClassifyActionParameterFieldHardcode(
                "location",
                { kind: "string" },
                true,
            ),
        ).toMatchObject({ create: "free_text", verify: "nonempty" });
        expect(
            tryClassifyActionParameterFieldHardcode(
                "message",
                { kind: "string" },
                false,
            ),
        ).toMatchObject({ create: "free_text", verify: "nonempty" });
        expect(
            tryClassifyActionParameterFieldHardcode(
                "when",
                { kind: "string" },
                false,
            ),
        ).toMatchObject({ create: "temporal", verify: "nonempty" });
        expect(
            tryClassifyActionParameterFieldHardcode(
                "kind",
                { kind: "string" },
                true,
            ),
        ).toMatchObject({ create: "unit_or_mode", verify: "ignore" });
        expect(
            tryClassifyActionParameterFieldHardcode(
                "units",
                { kind: "string", enum: ["celsius", "fahrenheit"] },
                true,
            ),
        ).toMatchObject({ create: "unit_or_mode", verify: "ignore" });
    });

    it("uses exact verify for enums, booleans, and numbers", () => {
        expect(
            tryClassifyActionParameterFieldHardcode(
                "tab",
                { kind: "string", enum: ["new", "current"] },
                true,
            ),
        ).toMatchObject({ create: "enum_literal", verify: "exact" });
        expect(
            tryClassifyActionParameterFieldHardcode(
                "enabled",
                { kind: "boolean" },
                false,
            ),
        ).toMatchObject({ create: "typed_literal", verify: "exact" });
        expect(
            tryClassifyActionParameterFieldHardcode(
                "limit",
                { kind: "number" },
                true,
            ),
        ).toMatchObject({ create: "typed_literal", verify: "exact" });
    });

    it("marks opaque any as ignore", () => {
        expect(
            tryClassifyActionParameterFieldHardcode(
                "payload",
                { kind: "any" },
                false,
            ),
        ).toMatchObject({ create: "opaque", verify: "ignore" });
    });

    it("treats site as free-text when typed as string (not any)", () => {
        expect(
            tryClassifyActionParameterFieldHardcode(
                "site",
                { kind: "string" },
                false,
            ),
        ).toMatchObject({ create: "free_text", verify: "nonempty" });
    });

    it("scores identity token lists as identifier/exact not free-text nonempty", () => {
        for (const name of [
            "existingActionNames",
            "possibleActionNames",
            "agentNames",
            "allowedCmdlets",
            "allowedModules",
            "includeActions",
            "excludeActions",
            "names",
        ]) {
            expect(
                tryClassifyActionParameterFieldHardcode(
                    name,
                    { kind: "array", item: { kind: "string" } },
                    false,
                ),
            ).toMatchObject({
                create: "identifier",
                verify: "exact",
                item: { create: "identifier", verify: "exact" },
            });
        }
        // Contrast: loose free-text collections stay nonempty.
        expect(
            tryClassifyActionParameterFieldHardcode(
                "sites",
                { kind: "array", item: { kind: "string" } },
                true,
            ),
        ).toMatchObject({
            create: "free_text",
            verify: "nonempty",
        });
    });

    it("softens pure free-text object containers (nested site[])", () => {
        const lookupInternet = objectSpec({
            site: {
                optional: true,
                spec: { kind: "array", item: { kind: "string" } },
            },
        });
        expect(
            tryClassifyActionParameterFieldHardcode(
                "lookup",
                lookupInternet,
                false,
            ),
        ).toMatchObject({
            create: "record",
            verify: "nonempty",
            rule: "type-object-soft-nonempty",
        });

        // Mixed exact + soft leaves stay exact (source enum is exact).
        const lookupMixed = objectSpec({
            source: {
                optional: false,
                spec: { kind: "string", enum: ["internet"] },
            },
            site: {
                optional: true,
                spec: { kind: "array", item: { kind: "string" } },
            },
        });
        expect(
            tryClassifyActionParameterFieldHardcode("lookup", lookupMixed, false),
        ).toMatchObject({
            create: "record",
            verify: "exact",
            rule: "type-object-exact",
        });
    });

    it("leaves unmatched open strings for the LLM (no soft default)", () => {
        expect(
            tryClassifyActionParameterFieldHardcode(
                "weirdField",
                { kind: "string" },
                false,
            ),
        ).toBeUndefined();
    });

    it("hardcodes originalRequest ignore and script llmAsAJudge without regex", () => {
        expect(
            tryClassifyActionParameterFieldHardcode(
                "originalRequest",
                { kind: "string" },
                false,
            ),
        ).toMatchObject({
            create: "free_text",
            verify: "ignore",
            rule: "string-original-request-ignore",
        });
        expect(
            tryClassifyActionParameterFieldHardcode(
                "script",
                { kind: "string" },
                false,
            ),
        ).toMatchObject({
            create: "free_text",
            verify: "llmAsAJudge",
            rule: "string-llm-as-a-judge",
        });
        expect(
            tryClassifyActionParameterFieldHardcode(
                "codeSnippet",
                { kind: "string" },
                false,
            ),
        ).toMatchObject({
            verify: "llmAsAJudge",
        });
    });

    it("does not reuse prior opaque/ignore when type is no longer any (site fix)", () => {
        const reused = tryReusePriorFieldGraderDecision(
            {
                optional: false,
                type: { kind: "any" },
                typeKind: "any",
                create: "opaque",
                verify: "ignore",
                rule: "type-any",
                source: "hardcode",
            },
            { kind: "string" },
        );
        expect(reused).toBeUndefined();
        expect(
            tryClassifyActionParameterFieldHardcode(
                "site",
                { kind: "string" },
                false,
            ),
        ).toMatchObject({ create: "free_text", verify: "nonempty" });
    });

    it("never reuses prior regex field policies (rules-bump safety)", () => {
        expect(
            tryReusePriorFieldGraderDecision(
                {
                    optional: false,
                    type: { kind: "string" },
                    typeKind: "string",
                    create: "free_text",
                    verify: "nonempty",
                    rule: "string-free-text-nonempty",
                    source: "hardcode",
                },
                { kind: "string" },
                false,
            ),
        ).toBeUndefined();
    });

    it("reuses prior LLM field policy when typeKind + optional match", () => {
        const reused = tryReusePriorFieldGraderDecision(
            {
                optional: false,
                type: { kind: "string" },
                typeKind: "string",
                create: "free_text",
                verify: "nonempty",
                rule: "llm:custom_script",
                source: "llm",
            },
            { kind: "string" },
            false,
        );
        expect(reused).toMatchObject({
            create: "free_text",
            verify: "nonempty",
            rule: "reused:llm:custom_script",
            source: "llm",
        });
    });

    it("does not reuse legacy string-default-nonempty or type-array-exact", () => {
        expect(
            tryReusePriorFieldGraderDecision(
                {
                    optional: false,
                    type: { kind: "string" },
                    typeKind: "string",
                    create: "free_text",
                    verify: "nonempty",
                    rule: "string-default-nonempty",
                    source: "llm",
                },
                { kind: "string" },
                false,
            ),
        ).toBeUndefined();
        expect(
            tryReusePriorFieldGraderDecision(
                {
                    optional: false,
                    type: { kind: "array", item: { kind: "string" } },
                    typeKind: "array<string>",
                    create: "free_text",
                    verify: "exact",
                    rule: "type-array-exact",
                    source: "llm",
                },
                { kind: "array", item: { kind: "string" } },
                false,
            ),
        ).toBeUndefined();
    });
});

describe("classifyActionParameterFieldWithFallback", () => {
    it("requires LLM for unmatched open strings (no soft default)", async () => {
        await expect(
            classifyActionParameterFieldWithFallback(
                "weirdField",
                { kind: "string" },
                false,
                { schemaName: "desktop", actionName: "ConnectWifi" },
            ),
        ).rejects.toThrow(/no regex rule|provide an LLM fallback/);
    });

    it("classifies array item then wraps even when item needs reuse/LLM path", async () => {
        const decision = await classifyActionParameterFieldWithFallback(
            "selectedIndices",
            { kind: "array", item: { kind: "number" } },
            false,
            { schemaName: "browser", actionName: "actionDiscovery" },
        );
        expect(decision).toMatchObject({
            verify: "exact",
            item: { create: "typed_literal", verify: "exact" },
            rule: "array-items:type-number",
        });
    });
});

describe("schemaTypeToParamSpec type-union", () => {
    it("collapses moniker literals | free string to open string (openWebPage.site)", () => {
        const site = schemaTypeToParamSpec({
            type: "type-union",
            types: [
                {
                    type: "string-union",
                    typeEnum: [
                        "paleobiodb",
                        "crossword",
                        "commerce",
                        "chatView",
                    ],
                },
                {
                    type: "type-reference",
                    name: "WebPageMoniker",
                    definition: {
                        name: "WebPageMoniker",
                        type: { type: "string" },
                    },
                },
            ],
        });
        expect(site).toEqual({ kind: "string" });
        expect(site).not.toEqual({ kind: "any" });
    });

    it("merges closed string-union arms into one enum", () => {
        expect(
            schemaTypeToParamSpec({
                type: "type-union",
                types: [
                    { type: "string-union", typeEnum: ["a", "b"] },
                    { type: "string-union", typeEnum: ["b", "c"] },
                ],
            }),
        ).toEqual({ kind: "string", enum: ["a", "b", "c"] });
    });

    it("renders type-union arms instead of the bare tag", () => {
        expect(
            renderSchemaType({
                type: "type-union",
                types: [
                    { type: "string-union", typeEnum: ["new", "current"] },
                    {
                        type: "type-reference",
                        definition: { type: { type: "string" } },
                    },
                ],
            }),
        ).toBe('"new"|"current"|string');
    });

    it("mergeUnionParamSpecs: open string wins over enum", () => {
        expect(
            mergeUnionParamSpecs([
                { kind: "string", enum: ["a"] },
                { kind: "string" },
            ]),
        ).toEqual({ kind: "string" });
    });

    it("keeps heterogeneous scalar unions as any", () => {
        expect(
            mergeUnionParamSpecs([{ kind: "string" }, { kind: "number" }]),
        ).toEqual({ kind: "any" });
    });

    it("merges MusicTarget-shaped object unions instead of any", () => {
        const target = mergeUnionParamSpecs([
            objectSpec({
                kind: {
                    optional: false,
                    spec: { kind: "string", enum: ["track"] },
                },
                trackName: { optional: false, spec: { kind: "string" } },
                artists: {
                    optional: true,
                    spec: { kind: "array", item: { kind: "string" } },
                },
            }),
            objectSpec({
                kind: {
                    optional: false,
                    spec: { kind: "string", enum: ["artist"] },
                },
                artist: { optional: false, spec: { kind: "string" } },
            }),
            objectSpec({
                kind: {
                    optional: false,
                    spec: { kind: "string", enum: ["query"] },
                },
                query: { optional: false, spec: { kind: "string" } },
            }),
        ]);
        expect(target.kind).toBe("object");
        expect(target).not.toEqual({ kind: "any" });
        if (target.kind === "object") {
            expect(target.fields.kind?.spec).toEqual({
                kind: "string",
                enum: ["track", "artist", "query"],
            });
            expect(target.fields.trackName?.optional).toBe(true);
            expect(target.fields.trackName?.spec).toEqual({ kind: "string" });
            expect(target.fields.query?.optional).toBe(true);
        }
    });

    it("merges StartLookup-shaped unions so site stays string[] not any", () => {
        const lookup = mergeUnionParamSpecs([
            objectSpec({
                source: {
                    optional: false,
                    spec: { kind: "string", enum: ["conversation"] },
                },
            }),
            objectSpec({
                source: {
                    optional: false,
                    spec: { kind: "string", enum: ["internet"] },
                },
                site: {
                    optional: true,
                    spec: { kind: "array", item: { kind: "string" } },
                },
            }),
        ]);
        expect(lookup.kind).toBe("object");
        if (lookup.kind === "object") {
            expect(lookup.fields.source?.spec).toEqual({
                kind: "string",
                enum: ["conversation", "internet"],
            });
            expect(lookup.fields.site?.optional).toBe(true);
            expect(lookup.fields.site?.spec).toEqual({
                kind: "array",
                item: { kind: "string" },
            });
        }
    });

    it("type-ref object arms render leaf strings not fake any", () => {
        const rendered = renderSchemaType({
            type: "type-union",
            types: [
                {
                    type: "type-reference",
                    name: "PlayByTrack",
                    definition: {
                        type: {
                            type: "object",
                            fields: {
                                kind: {
                                    optional: false,
                                    type: {
                                        type: "string-union",
                                        typeEnum: ["track"],
                                    },
                                },
                                trackName: {
                                    optional: false,
                                    type: { type: "string" },
                                },
                            },
                        },
                    },
                },
                {
                    type: "type-reference",
                    name: "StartLookupInternet",
                    definition: {
                        type: {
                            type: "object",
                            fields: {
                                source: {
                                    optional: false,
                                    type: {
                                        type: "string-union",
                                        typeEnum: ["internet"],
                                    },
                                },
                                site: {
                                    optional: true,
                                    type: {
                                        type: "array",
                                        elementType: { type: "string" },
                                    },
                                },
                            },
                        },
                    },
                },
            ],
        });
        expect(rendered).toContain("trackName: string");
        expect(rendered).toContain("site?: string[]");
        expect(rendered).not.toMatch(/trackName:\s*any/);
        expect(rendered).not.toMatch(/site\?: any/);
    });

    it("preserves DateVal/TimeVal number leaves under optional timeRange unions", () => {
        // Depth path: array item object → timeRange → DateTimeRange → DateTime → DateVal → day
        const termFilter = schemaTypeToParamSpec(termFilterTimeRangeAst());
        expect(termFilter.kind).toBe("object");
        if (termFilter.kind !== "object") return;
        const timeRange = termFilter.fields.timeRange?.spec;
        expect(timeRange?.kind).toBe("object");
        if (timeRange?.kind !== "object") return;

        const startDate = timeRange.fields.startDate?.spec;
        expect(startDate?.kind).toBe("object");
        if (startDate?.kind !== "object") return;
        const date = startDate.fields.date?.spec;
        expect(date).toEqual({
            kind: "object",
            fields: {
                day: { optional: false, spec: { kind: "number" } },
                month: { optional: false, spec: { kind: "number" } },
                year: { optional: false, spec: { kind: "number" } },
            },
        });
        const time = startDate.fields.time?.spec;
        expect(time).toEqual({
            kind: "object",
            fields: {
                hour: { optional: false, spec: { kind: "number" } },
                minute: { optional: false, spec: { kind: "number" } },
                seconds: { optional: false, spec: { kind: "number" } },
            },
        });

        const stopDate = timeRange.fields.stopDate?.spec;
        expect(stopDate?.kind).toBe("object");
        if (stopDate?.kind === "object") {
            expect(stopDate.fields.date?.spec.kind).toBe("object");
            if (stopDate.fields.date?.spec.kind === "object") {
                expect(stopDate.fields.date.spec.fields.day?.spec).toEqual({
                    kind: "number",
                });
            }
        }

        // parameters summary must not print date: any
        const rendered = renderSchemaType({
            type: "object",
            fields: {
                timeRange: {
                    optional: true,
                    type: {
                        type: "type-union",
                        types: [
                            termFilterTimeRangeAst().fields.timeRange.type
                                .types![0]!,
                            { type: "undefined" },
                        ],
                    },
                },
            },
        });
        expect(rendered).not.toMatch(/date:\s*any/);
        expect(rendered).not.toMatch(/time\?:\s*any/);
        expect(rendered).not.toMatch(/stopDate\?:\s*any/);
        expect(rendered).not.toMatch(/\|undefined/);
        expect(rendered).toMatch(/day:\s*number/);
    });
});

describe("paramTypes discriminant kind", () => {
    it("isParamSpec accepts kind and rejects k", () => {
        expect(isParamSpec({ kind: "string" })).toBe(true);
        expect(isParamSpec({ k: "string" })).toBe(false);
        expect(isParamSpec({ kind: "number" })).toBe(true);
        expect(isParamSpec({ kind: "array", item: { kind: "string" } })).toBe(
            true,
        );
    });

    it("canonicalizeParamSpec sorts enums and keeps kind key only", () => {
        expect(
            canonicalizeParamSpec({ kind: "string", enum: ["b", "a"] }),
        ).toEqual({ kind: "string", enum: ["a", "b"] });
        const canon = canonicalizeParamSpec({ kind: "string" }) as Record<
            string,
            unknown
        >;
        expect(Object.keys(canon)).toEqual(["kind"]);
        expect(canon.kind).toBe("string");
        expect("k" in canon).toBe(false);
    });

    it("load rejects byAction entry whose paramSpec uses k", () => {
        const dir = mkdtempSync(path.join(tmpdir(), "grader-kind-"));
        const bad = path.join(dir, "bad-k.json");
        writeFileSync(
            bad,
            JSON.stringify({
                version: 1,
                byAction: {
                    "a.b": {
                        schemaName: "a",
                        actionName: "b",
                        paramSpec: { k: "object", fields: {} },
                        sourceFingerprint: "0123456789abcdef",
                        fields: {},
                        parameterScore: {
                            defaultMode: "exact",
                            fields: {},
                        },
                    },
                },
            }),
        );
        expect(() => loadActionParametersGraderCatalogFile(bad)).toThrow(
            /paramSpec/,
        );
    });
});

describe("buildActionParametersGraderEntry", () => {
    it("emits runner-ready parameterScore with exact number[] and loose string[]", async () => {
        const entry = await buildActionParametersGraderEntry(
            "list",
            "addItems",
            objectSpec({
                items: {
                    optional: false,
                    spec: { kind: "array", item: { kind: "string" } },
                },
                selectedIndices: {
                    optional: false,
                    spec: { kind: "array", item: { kind: "number" } },
                },
                listName: { optional: false, spec: { kind: "string" } },
            }),
        );
        expect(entry.parameterScore).toEqual({
            defaultMode: "exact",
            fields: {
                items: "nonempty",
                selectedIndices: "exact",
                listName: "exact",
            },
        });
        expect(entry.fields.items?.item).toMatchObject({
            create: "free_text",
            verify: "nonempty",
        });
        expect(entry.fields.selectedIndices?.item).toMatchObject({
            create: "typed_literal",
            verify: "exact",
        });
        expect(entry.sourceFingerprint).toHaveLength(16);
    });

    it("scores merged object-union targets as record not ignore", async () => {
        const target = mergeUnionParamSpecs([
            objectSpec({
                kind: {
                    optional: false,
                    spec: { kind: "string", enum: ["track"] },
                },
                trackName: { optional: false, spec: { kind: "string" } },
            }),
            objectSpec({
                kind: {
                    optional: false,
                    spec: { kind: "string", enum: ["query"] },
                },
                query: { optional: false, spec: { kind: "string" } },
            }),
        ]);
        const entry = await buildActionParametersGraderEntry(
            "player",
            "playMusic",
            objectSpec({
                target: { optional: false, spec: target },
            }),
        );
        expect(entry.fields.target?.create).toBe("record");
        expect(entry.fields.target?.verify).not.toBe("ignore");
        expect(entry.fields.target?.rule).not.toBe("type-any");
    });

    it("scores nested free-text-only objects as nonempty not exact", async () => {
        const entry = await buildActionParametersGraderEntry(
            "dispatcher.lookup",
            "startLookup",
            objectSpec({
                lookup: {
                    optional: false,
                    spec: objectSpec({
                        site: {
                            optional: true,
                            spec: { kind: "array", item: { kind: "string" } },
                        },
                    }),
                },
            }),
        );
        expect(entry.fields.lookup).toMatchObject({
            create: "record",
            verify: "nonempty",
            rule: "type-object-soft-nonempty",
        });
        expect(entry.parameterScore.fields.lookup).toBe("nonempty");
    });
});

describe("loadActionParametersGraderCatalogFile", () => {
    it("rejects byAction null and missing sourceFingerprint", () => {
        const dir = mkdtempSync(path.join(tmpdir(), "grader-load-"));
        const badByAction = path.join(dir, "bad-byAction.json");
        writeFileSync(
            badByAction,
            JSON.stringify({ version: 1, byAction: null }),
        );
        expect(() =>
            loadActionParametersGraderCatalogFile(badByAction),
        ).toThrow(/byAction/);

        const badFp = path.join(dir, "bad-fp.json");
        writeFileSync(
            badFp,
            JSON.stringify({
                version: 1,
                byAction: {
                    "a.b": {
                        schemaName: "a",
                        actionName: "b",
                        paramSpec: { kind: "object", fields: {} },
                        fields: {},
                        parameterScore: { defaultMode: "exact", fields: {} },
                    },
                },
            }),
        );
        expect(() => loadActionParametersGraderCatalogFile(badFp)).toThrow(
            /sourceFingerprint/,
        );
    });

    it("rejects parameterScore drift and nested legacy item rules", async () => {
        const listSpec = objectSpec({
            listName: { optional: false, spec: { kind: "string" } },
        });
        const good = await buildActionParametersGraderEntry(
            "list",
            "createList",
            listSpec,
        );
        const dir = mkdtempSync(path.join(tmpdir(), "grader-score-"));
        const drift = path.join(dir, "drift.json");
        const poisoned = structuredClone(good);
        poisoned.parameterScore.fields.listName = "ignore";
        writeFileSync(
            drift,
            JSON.stringify({
                version: 1,
                byAction: { "list.createList": poisoned },
            }),
        );
        expect(() => loadActionParametersGraderCatalogFile(drift)).toThrow(
            /parameterScore/,
        );

        const nestedLegacy = path.join(dir, "nested-legacy.json");
        const withItem = await buildActionParametersGraderEntry(
            "list",
            "addItems",
            objectSpec({
                items: {
                    optional: false,
                    spec: { kind: "array", item: { kind: "string" } },
                },
            }),
        );
        withItem.fields.items!.item = {
            create: "free_text",
            verify: "nonempty",
            rule: "string-default-nonempty",
            source: "hardcode",
        };
        writeFileSync(
            nestedLegacy,
            JSON.stringify({
                version: 1,
                byAction: { "list.addItems": withItem },
            }),
        );
        expect(() =>
            loadActionParametersGraderCatalogFile(nestedLegacy),
        ).toThrow(/legacy|default/i);
    });
});

describe("incremental grader catalog", () => {
    it("only rebuilds added/updated actions and drops removed", async () => {
        const weatherSpec = objectSpec({
            location: { optional: false, spec: { kind: "string" } },
            units: {
                optional: true,
                spec: {
                    kind: "string",
                    enum: ["celsius", "fahrenheit"],
                },
            },
        });
        const listSpec = objectSpec({
            listName: { optional: false, spec: { kind: "string" } },
        });

        const first = await buildActionParametersGraderCatalog({
                catalogVersion: "2026-01-01",
                actions: [
                    {
                        schemaName: "weather",
                        actionName: "getCurrentConditions",
                        paramSpec: weatherSpec,
                        parameters: "location, units?",
                    },
                    {
                        schemaName: "list",
                        actionName: "createList",
                        paramSpec: listSpec,
                        parameters: "listName",
                    },
                ],
            }, {  generatedAt: "2026-01-01T00:00:00.000Z", assertOverridesMatchCatalog: false });

        expect(first.lastDiff?.added).toEqual([
            "list.createList",
            "weather.getCurrentConditions",
        ]);

        const weatherUpdated = objectSpec({
            location: { optional: false, spec: { kind: "string" } },
            units: {
                optional: true,
                spec: {
                    kind: "string",
                    enum: ["celsius", "fahrenheit", "kelvin"],
                },
            },
        });
        const timerSpec = objectSpec({
            message: { optional: false, spec: { kind: "string" } },
            when: { optional: false, spec: { kind: "string" } },
        });

        const second = await buildActionParametersGraderCatalog({
                catalogVersion: "2026-01-02",
                actions: [
                    {
                        schemaName: "weather",
                        actionName: "getCurrentConditions",
                        paramSpec: weatherUpdated,
                        parameters: "location, units?",
                    },
                    {
                        schemaName: "timer",
                        actionName: "setReminder",
                        paramSpec: timerSpec,
                        parameters: "message, when",
                    },
                ],
            }, { 
                previous: first,
                generatedAt: "2026-01-02T00:00:00.000Z", assertOverridesMatchCatalog: false });

        expect(second.lastDiff).toEqual({
            added: ["timer.setReminder"],
            updated: ["weather.getCurrentConditions"],
            removed: ["list.createList"],
            unchanged: [],
        });
        expect(second.byAction["list.createList"]).toBeUndefined();
        expect(second.byAction["timer.setReminder"]).toBeDefined();

        const third = await buildActionParametersGraderCatalog({
                catalogVersion: "2026-01-03",
                actions: [
                    {
                        schemaName: "list",
                        actionName: "createList",
                        paramSpec: listSpec,
                        parameters: "listName",
                    },
                    {
                        schemaName: "timer",
                        actionName: "setReminder",
                        paramSpec: timerSpec,
                        parameters: "message, when",
                    },
                ],
            }, {  previous: second, generatedAt: "2026-01-03T00:00:00.000Z", assertOverridesMatchCatalog: false });
        expect(third.lastDiff?.added).toContain("list.createList");
        expect(third.lastDiff?.unchanged).toContain("timer.setReminder");
        expect(third.byAction["timer.setReminder"]).toBe(
            second.byAction["timer.setReminder"],
        );
        expect(third.byAction["list.createList"]!.sourceFingerprint).toBe(
            actionParameterSourceFingerprint(listSpec, "listName"),
        );
    });

    it("forceFull ignores previous defaults", async () => {
        const listSpec = objectSpec({
            listName: { optional: false, spec: { kind: "string" } },
        });
        const first = await buildActionParametersGraderCatalog({
                catalogVersion: "2026-01-01",
                actions: [
                    {
                        schemaName: "list",
                        actionName: "createList",
                        paramSpec: listSpec,
                    },
                ],
            }, {  generatedAt: "2026-01-01T00:00:00.000Z", assertOverridesMatchCatalog: false });
        // Poison a field as if legacy reuse had stuck.
        first.byAction["list.createList"]!.fields.listName = {
            optional: false,
            type: { kind: "string" },
            typeKind: "string",
            create: "free_text",
            verify: "nonempty",
            rule: "string-default-nonempty",
            source: "hardcode",
        };
        first.byAction["list.createList"]!.parameterScore.fields.listName =
            "nonempty";

        const forced = await buildActionParametersGraderCatalog({
                catalogVersion: "2026-01-02",
                actions: [
                    {
                        schemaName: "list",
                        actionName: "createList",
                        paramSpec: listSpec,
                    },
                ],
            }, { 
                previous: first,
                forceFull: true,
                generatedAt: "2026-01-02T00:00:00.000Z", assertOverridesMatchCatalog: false });
        expect(forced.byAction["list.createList"]!.fields.listName?.rule).toBe(
            "string-identifier-exact",
        );
        expect(
            forced.byAction["list.createList"]!.fields.listName?.rule,
        ).not.toMatch(/default/);
    });

    it("fingerprint ignores parameters summary order/text", () => {
        const spec = objectSpec({
            a: { optional: false, spec: { kind: "string" } },
        });
        expect(actionParameterSourceFingerprint(spec, "a: string")).toBe(
            actionParameterSourceFingerprint(spec, "totally different"),
        );
    });

    it("sourceFingerprint is paramSpec-only (stable across policy metadata)", async () => {
        const listSpec = objectSpec({
            listName: { optional: false, spec: { kind: "string" } },
        });
        const first = await buildActionParametersGraderCatalog({
                catalogVersion: "2026-01-01",
                actions: [
                    {
                        schemaName: "list",
                        actionName: "createList",
                        paramSpec: listSpec,
                    },
                ],
            }, {  generatedAt: "2026-01-01T00:00:00.000Z", assertOverridesMatchCatalog: false });
        const fp = first.byAction["list.createList"]!.sourceFingerprint;
        expect(fp).toBe(actionParameterSourceFingerprint(listSpec));
        expect(first.rulesFingerprint).toMatch(/^[0-9a-f]{16}$/);

        // Same schema + matching rulesFingerprint → incremental keeps entry.
        const second = await buildActionParametersGraderCatalog({
                catalogVersion: "2026-01-02",
                actions: [
                    {
                        schemaName: "list",
                        actionName: "createList",
                        paramSpec: listSpec,
                    },
                ],
            }, { 
                previous: first,
                generatedAt: "2026-01-02T00:00:00.000Z", assertOverridesMatchCatalog: false });
        expect(second.byAction["list.createList"]!.sourceFingerprint).toBe(fp);
        expect(second.lastDiff?.unchanged).toContain("list.createList");

        // Rules drift (stale catalog rulesFingerprint) → full reclassify, but
        // sourceFingerprint stays the same because paramSpec did not change.
        const staleRules = {
            ...first,
            rulesFingerprint: "0000000000000000",
        };
        const third = await buildActionParametersGraderCatalog({
                catalogVersion: "2026-01-03",
                actions: [
                    {
                        schemaName: "list",
                        actionName: "createList",
                        paramSpec: listSpec,
                    },
                ],
            }, { 
                previous: staleRules,
                generatedAt: "2026-01-03T00:00:00.000Z", assertOverridesMatchCatalog: false });
        expect(third.byAction["list.createList"]!.sourceFingerprint).toBe(fp);
        expect(third.rulesFingerprint).toBe(first.rulesFingerprint);
        expect(third.lastDiff?.added).toContain("list.createList");
    });

    it("diff reports full add when no previous catalog", () => {
        const diff = diffActionParametersGrader(
            {
                catalogVersion: "x",
                actions: [
                    {
                        schemaName: "a",
                        actionName: "b",
                        paramSpec: objectSpec({}),
                    },
                ],
            },
            undefined,
        );
        expect(diff).toEqual({
            added: ["a.b"],
            updated: [],
            removed: [],
            unchanged: [],
        });
    });

    it("builds recommendedByAction map on demand", async () => {
        const catalog = await buildActionParametersGraderCatalog({
                catalogVersion: "2026-01-01",
                actions: [
                    {
                        schemaName: "weather",
                        actionName: "getCurrentConditions",
                        paramSpec: objectSpec({
                            location: {
                                optional: false,
                                spec: { kind: "string" },
                            },
                            units: {
                                optional: true,
                                spec: {
                                    kind: "string",
                                    enum: ["celsius", "fahrenheit"],
                                },
                            },
                        }),
                    },
                ],
            }, {  generatedAt: "2026-01-01T00:00:00.000Z", assertOverridesMatchCatalog: false });
        expect(toRecommendedByActionVerifyMap(catalog)).toEqual({
            "weather.getCurrentConditions": {
                location: "nonempty",
                units: "ignore",
            },
        });
    });

    it("force-rebuilds when stored fingerprint disagrees with paramSpec", async () => {
        const listSpec = objectSpec({
            listName: { optional: false, spec: { kind: "string" } },
        });
        const first = await buildActionParametersGraderCatalog({
                catalogVersion: "2026-01-01",
                actions: [
                    {
                        schemaName: "list",
                        actionName: "createList",
                        paramSpec: listSpec,
                    },
                ],
            }, {  generatedAt: "2026-01-01T00:00:00.000Z", assertOverridesMatchCatalog: false });
        // Corrupt fingerprint string while keeping shape — looks "stable" to naive diffs.
        first.byAction["list.createList"]!.sourceFingerprint =
            "deadbeefdeadbeef";
        // Also poison verify so rebuild is observable.
        first.byAction["list.createList"]!.fields.listName!.verify = "ignore";
        first.byAction["list.createList"]!.parameterScore.fields.listName =
            "ignore";

        // Diff still thinks updated because fingerprint string ≠ live hash.
        const diff = diffActionParametersGrader(
            {
                catalogVersion: "2026-01-02",
                actions: [
                    {
                        schemaName: "list",
                        actionName: "createList",
                        paramSpec: listSpec,
                    },
                ],
            },
            first,
        );
        expect(diff.updated).toContain("list.createList");

        const rebuilt = await buildActionParametersGraderCatalog({
                catalogVersion: "2026-01-02",
                actions: [
                    {
                        schemaName: "list",
                        actionName: "createList",
                        paramSpec: listSpec,
                    },
                ],
            }, {  previous: first, generatedAt: "2026-01-02T00:00:00.000Z", assertOverridesMatchCatalog: false });
        expect(
            rebuilt.byAction["list.createList"]!.fields.listName?.verify,
        ).toBe("exact");
        expect(rebuilt.byAction["list.createList"]!.sourceFingerprint).toBe(
            actionParameterSourceFingerprint(listSpec),
        );
    });
});

describe("GRADER_RULES_VERSION contract", () => {
    it("exports a stable HARDCODE_RULE_IDS allowlist tied to version bumps", () => {
        expect(GRADER_RULES_VERSION).toBeGreaterThanOrEqual(6);
        expect(HARDCODE_RULE_IDS.length).toBeGreaterThan(5);
        expect(HARDCODE_RULE_IDS).not.toContain("string-open-soft-nonempty");
        expect(HARDCODE_RULE_IDS).toContain("string-original-request-ignore");
        expect(HARDCODE_RULE_IDS).toContain("string-date-nonempty");
        expect(HARDCODE_RULE_IDS).not.toContain("string-date-exact");
        expect(HARDCODE_RULE_IDS).toContain("type-object-soft-nonempty");
        expect(HARDCODE_RULE_IDS).toContain("string-llm-as-a-judge");
        // Pin allowlist hash; bump GRADER_RULES_VERSION with id edits.
        const hash = createHash("sha256")
            .update(JSON.stringify([...HARDCODE_RULE_IDS].sort()))
            .digest("hex")
            .slice(0, 16);
        // Bump GRADER_RULES_VERSION with this hash when rules change.
        expect(hash).toBe("e00092cd4ae26688");
    });
});

describe("eligible action coverage counting", () => {
    it("subtracts excluded actions from the catalog total", () => {
        const schemas = [
            {
                schemaName: "alpha",
                tools: [
                    { function: { name: "keep" } },
                    { function: { name: "drop" } },
                ],
            },
            {
                schemaName: "beta",
                tools: [{ function: { name: "keep" } }],
            },
        ];
        expect(
            countEligibleTranslationBenchActions(
                schemas,
                new Set(["alpha.drop"]),
            ),
        ).toBe(2);
        expect(countEligibleTranslationBenchActions(schemas, new Set())).toBe(
            3,
        );
    });

    it("excludes policy removedActions (exact ids) from the packaged exclusion set", () => {
        clearPackagedActionEligibilityPolicyCacheForTests();
        // Catalog must include every exact removedActions id (fail-closed expand).
        const exactRemoved = [
            "browser.lookupAndAnswer.lookupAndAnswerInternet",
            "browser.searchImageAction",
            "chat.generateResponse",
            "dispatcher.lookup.lookupAndAnswerConversation",
            "dispatcher.reasoning.reasoningAction",
            "image.createImageAction",
            "image.editImageAction",
            "markdown.streamingUpdateDocument",
            "markdown.updateDocument",
            "photo.takePhoto",
            "settings.adjustMultiMonitorLayoutAction",
            "settings.dimBrightNessAction",
            "video.createVideoAction",
            "system.help.answerTypeAgentQuestion",
            "utility.claudeTask",
        ];
        const bySchema = new Map<string, string[]>();
        for (const id of exactRemoved) {
            // schema may contain dots (e.g. browser.lookupAndAnswer)
            const lastDot = id.lastIndexOf(".");
            const schemaName = id.slice(0, lastDot);
            const actionName = id.slice(lastDot + 1);
            const list = bySchema.get(schemaName) ?? [];
            list.push(actionName);
            bySchema.set(schemaName, list);
        }
        // Keep one non-removed action that has llmAsAJudge fields in policy.
        const browserTools = bySchema.get("browser") ?? [];
        browserTools.push("executeAdHocScript");
        bySchema.set("browser", browserTools);

        const schemas = [...bySchema.entries()].map(([schemaName, names]) => ({
            schemaName,
            tools: names.map((name) => ({ function: { name } })),
        }));
        const excluded = getPackagedScheduleExcludedActionIds(schemas, {
            allowMissingExactIds: true,
            applyEligibleGoldAllowlist: false,
        });
        for (const id of exactRemoved) {
            expect(excluded.has(id)).toBe(true);
        }
        // Freeform script action is human-removed (hard veto), not merely llmAsAJudge.
        expect(excluded.has("browser.executeAdHocScript")).toBe(true);
        // Allowlisted non-judge action remains schedulable under allowlist-off lattice.
        expect(excluded.has("browser.openWebPage")).toBe(false);
    });
});

describe("hardcoded nonempty for conversation topic titles", () => {
    it("soft-scores conversation name params without loosening identity names", async () => {
        const catalog = {
            catalogVersion: "test",
            generatedAt: "2026-01-01T00:00:00.000Z",
            actions: [
                {
                    schemaName: "system.conversation",
                    actionName: "summarizeConversation",
                    paramSpec: objectSpec({
                        name: {
                            optional: true,
                            spec: { kind: "string" },
                        },
                    }),
                },
                {
                    schemaName: "system.conversation",
                    actionName: "indexConversation",
                    paramSpec: objectSpec({
                        name: {
                            optional: true,
                            spec: { kind: "string" },
                        },
                    }),
                },
                {
                    schemaName: "list",
                    actionName: "removeItems",
                    paramSpec: objectSpec({
                        listName: {
                            optional: false,
                            spec: { kind: "string" },
                        },
                    }),
                },
            ],
        };
        const grader = await buildActionParametersGraderCatalog(catalog, { assertOverridesMatchCatalog: false });
        expect(
            grader.byAction["system.conversation.summarizeConversation"]!
                .parameterScore.fields.name,
        ).toBe("nonempty");
        expect(
            grader.byAction["system.conversation.indexConversation"]!
                .parameterScore.fields.name,
        ).toBe("nonempty");
        expect(
            grader.byAction["list.removeItems"]!.parameterScore.fields.listName,
        ).toBe("exact");
    });
});

describe("hardcoded llmAsAJudge for internet lookup params", () => {
    it("applies policy overrides for lookupAndAnswerInternet params", async () => {
        const catalog = {
            catalogVersion: "test",
            generatedAt: "2026-01-01T00:00:00.000Z",
            actions: [
                {
                    schemaName: "browser.lookupAndAnswer",
                    actionName: "lookupAndAnswerInternet",
                    paramSpec: objectSpec({
                        originalRequest: {
                            optional: false,
                            spec: { kind: "string" },
                        },
                        internetLookups: {
                            optional: false,
                            spec: {
                                kind: "array",
                                item: { kind: "string" },
                            },
                        },
                        sites: {
                            optional: true,
                            spec: {
                                kind: "array",
                                item: { kind: "string" },
                            },
                        },
                    }),
                },
            ],
        };
        const grader = await buildActionParametersGraderCatalog(catalog, { assertOverridesMatchCatalog: false });
        const entry =
            grader.byAction["browser.lookupAndAnswer.lookupAndAnswerInternet"]!;
        expect(entry.parameterScore.fields).toEqual({
            originalRequest: "ignore",
            internetLookups: "llmAsAJudge",
            sites: "llmAsAJudge",
        });
        expect(entry.fields.internetLookups.verify).toBe("llmAsAJudge");
        expect(entry.fields.originalRequest.verify).toBe("ignore");
        expect(entry.fields.sites.verify).toBe("llmAsAJudge");
        // originalRequest is policy-overridden to ignore, not llmAsAJudge
        expect(
            parameterRequiresLlmJudge("originalRequest", {
                create: "free_text",
                actionId: "browser.lookupAndAnswer.lookupAndAnswerInternet",
            }),
        ).toBe(false);
    });
});

describe("llmAsAJudge verify mode", () => {
    it("uses hardcoded action.parameter pairs; LLM may still emit llmAsAJudge", () => {
        expect(
            parameterRequiresLlmJudge("script", {
                create: "free_text",
                actionId: "browser.executeAdHocScript",
            }),
        ).toBe(true);
        expect(
            parameterRequiresLlmJudge("command", {
                create: "free_text",
                actionId: "github-cli.aliasSet",
            }),
        ).toBe(false); // gh alias set stores a literal command → exact, not judge
        expect(
            parameterRequiresLlmJudge("description", {
                create: "free_text",
                actionId: "browser.executeAdHocScript",
            }),
        ).toBe(false);
        expect(
            parameterRequiresLlmJudge("script", {
                create: "identifier",
                actionId: "browser.executeAdHocScript",
            }),
        ).toBe(false);
    });

    it("upgrades hardcoded pairs to llmAsAJudge without changing create", () => {
        const upgraded = applyLlmAsAJudgeVerify(
            "script",
            {
                create: "free_text",
                verify: "nonempty",
                rule: "string-free-text-nonempty",
                source: "hardcode",
            },
            { actionId: "browser.executeAdHocScript" },
        );
        expect(upgraded).toEqual({
            create: "free_text",
            verify: "llmAsAJudge",
            rule: "string-llm-as-a-judge",
            source: "hardcode",
        });
        const plain = applyLlmAsAJudgeVerify(
            "title",
            {
                create: "free_text",
                verify: "nonempty",
                rule: "string-free-text-nonempty",
                source: "hardcode",
            },
            { actionId: "browser.executeAdHocScript" },
        );
        expect(plain.verify).toBe("nonempty");
    });

    it("marks hardcoded pairs on build; other actions stay non-judge offline", async () => {
        const catalog = {
            catalogVersion: "test",
            generatedAt: "2026-01-01T00:00:00.000Z",
            actions: [
                {
                    schemaName: "browser",
                    actionName: "executeAdHocScript",
                    paramSpec: objectSpec({
                        script: {
                            optional: false,
                            spec: { kind: "string" },
                        },
                        timeout: {
                            optional: true,
                            spec: { kind: "number" },
                        },
                    }),
                },
                {
                    schemaName: "list",
                    actionName: "createList",
                    paramSpec: objectSpec({
                        listName: {
                            optional: false,
                            spec: { kind: "string" },
                        },
                    }),
                },
            ],
        };
        const grader = await buildActionParametersGraderCatalog(catalog as any, {  forceFull: true, assertOverridesMatchCatalog: false });
        expect(
            grader.byAction["browser.executeAdHocScript"]!.fields.script
                ?.verify,
        ).toBe("llmAsAJudge");
        expect(
            grader.byAction["browser.executeAdHocScript"]!.parameterScore.fields
                .script,
        ).toBe("llmAsAJudge");
        expect(
            grader.byAction["list.createList"]!.fields.listName?.verify,
        ).not.toBe("llmAsAJudge");
    });
});

describe("genCatalog import path (OOM guard)", () => {
    it("forbids heavy provider / dispatcher import strings in genCatalog source", () => {
        const here = path.dirname(fileURLToPath(import.meta.url));
        // Jest runs compiled specs from dist/test; source specs live under test/.
        const candidates = [
            path.resolve(
                here,
                "../../src/translationBench/scripts/genCatalog.ts",
            ),
            path.resolve(here, "../src/translationBench/scripts/genCatalog.ts"),
        ];
        const src = candidates.find((p) => {
            try {
                readFileSync(p, "utf8");
                return true;
            } catch {
                return false;
            }
        });
        expect(src).toBeDefined();
        const text = readFileSync(src!, "utf8");
        // Strip block + line comments so prose mentioning forbidden modules is ignored.
        const codeOnly = text
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/^\s*\/\/.*$/gm, "");
        const importLike =
            /(?:from\s+|import\s*\(|require\s*\()\s*["']([^"']+)["']/g;
        const imported: string[] = [];
        for (const m of codeOnly.matchAll(importLike)) {
            imported.push(m[1]!);
        }
        // Dynamic path.join segments that load dispatcher modules
        const dynamicLoads = [
            ...codeOnly.matchAll(
                /["']([^"']*(?:actionSchemaFileCache|agentTranslators|pendingActions)[^"']*)["']/g,
            ),
        ].map((m) => m[1]!);

        const forbiddenSubstrings = [
            "default-agent-provider",
            "dispatcher-node-providers",
            "agent-dispatcher/internal",
            "msal-node-extensions",
            "msal-node",
            "actionSchemaFileCache",
            "agentTranslators",
            "pendingActions",
        ];
        for (const mod of [...imported, ...dynamicLoads]) {
            for (const needle of forbiddenSubstrings) {
                expect(mod).not.toContain(needle);
            }
        }
        // Must use lightweight action-schema parse path + atomic publish.
        expect(codeOnly).toContain("parseActionSchemaSource");
        expect(codeOnly).toMatch(/convertToActionConfig/);
        expect(codeOnly).toContain(".tmp");
        expect(codeOnly).toContain("renameSync");
        expect(codeOnly).toContain("actionConfig.js");
        // No runtime load of the fat cache module (string may appear only in comments).
        expect(codeOnly).not.toMatch(
            /["'][^"']*actionSchemaFileCache[^"']*["']/i,
        );
        expect(codeOnly).not.toMatch(/import\s*\([^)]*actionSchemaFileCache/i);
    });
});
