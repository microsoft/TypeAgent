// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    incompletePreservation,
    parseSupportQuality,
    supportQuality,
    worstSupportQuality,
    type ViewSupportStatus,
} from "../src/viewSupport.js";
import {
    assertEditorialAssessment,
    editorialAssessmentSchema,
    parseEditorialAssessment,
    wikiSupportCriteria,
    wikiSupportRules,
    wikiCoverageNoteRules,
    wikiPreservationCriteria,
    partialSupportRules,
    wikiAssertionSupportCriteria,
    wikiCategorySupportCriteria,
    wikiCategorySupportRules,
} from "../src/viewEditorial.js";

test("frozen support criteria distinguish unverified additions from contradictions and prior omissions", () => {
    expect(wikiSupportCriteria).toEqual({
        supported:
            "Every evaluated assertion is grounded in original indexed evidence with its original scope, qualifications and temporal state.",
        partiallySupported:
            "Useful grounded claims are present alongside incomplete or unverified assertions, with no identified contradiction or material source/scope misrepresentation. Missing verification alone does not make this unsupported.",
        unsupported:
            "An evaluated assertion has an identified contradiction or material source/scope misrepresentation, or the evaluated content has no useful grounded portion. Mere lack of verification for some assertions alongside useful grounded claims is not unsupported.",
        uncertain:
            "The supplied original evidence does not permit a reliable judgment about grounding or contradiction. Do not guess.",
    });
    expect(wikiPreservationCriteria.partiallySupported).toBe(
        "A useful verified portion of prior supported claims is preserved, but missing original evidence prevents verifying remaining prior claims or qualifications. No identifiable still-supported in-scope prior claim or material qualification is known to be missing or weakened. This does not authorize overwriting the prior article.",
    );
    expect(wikiPreservationCriteria.unsupported).toBe(
        "At least one still-supported in-scope prior claim or material qualification is missing or weakened in actual current prose.",
    );
    expect(partialSupportRules).toContain(wikiSupportRules);
    expect(partialSupportRules).toContain(wikiCoverageNoteRules);
    expect(partialSupportRules).toContain(wikiCategorySupportRules);
    expect(wikiCoverageNoteRules).toContain(
        "may be partiallySupported or uncertain even when the note itself has no verified assertion",
    );
    expect(wikiSupportRules).toContain(
        "An assertion is not contradicted merely because its supporting evidence is absent.",
    );
    expect(
        [wikiSupportRules, wikiCoverageNoteRules, partialSupportRules].join(
            "\n",
        ),
    ).not.toMatch(
        /one such counterexample|contradicted, ungrounded|any unsupported assertion/i,
    );
    expect(wikiAssertionSupportCriteria.unsupported).toBe(
        "An actual assertion in this group has an identified contradiction or material source/scope misrepresentation. Missing verification or absence of a verified assertion in this group alone is not unsupported.",
    );
    expect(wikiAssertionSupportCriteria.unsupported).not.toContain(
        "no useful grounded portion",
    );
    expect(wikiCategorySupportRules).toContain(
        "Only newContentSupport determines whether the article has any useful grounded portion.",
    );
});

test("category presence contract gates support on actual named-category assertions", () => {
    expect(wikiCategorySupportRules).toContain(
        "ACTUALLY PRESENT in content for that category. Answer not_asserted when content makes no assertion in this category,\nthen stop judging that category.",
    );
    expect(wikiCategorySupportRules).toContain(
        "Ignore assertions outside the named category: unrelated unverified or contradicted claims cannot make\nthis category unsupported.",
    );
    expect(wikiCategorySupportCriteria.unsupported).toBe(
        "Content makes an actual assertion in the requested category with an identified category-specific contradiction or material source/scope misrepresentation. An unrelated claim, missing verification, or no verified assertion in this category is not grounds for unsupported. An absent category must be not_asserted.",
    );
    expect(wikiCategorySupportCriteria.not_asserted).toBe(
        "Content makes no actual assertion in the requested category. Choose not_asserted, not unsupported or uncertain. The category is inapplicable; a topic label or an assertion found only in source fragments does not count.",
    );
    for (const status of [
        "supported",
        "partiallySupported",
        "unsupported",
        "uncertain",
    ] as const)
        expect(wikiCategorySupportCriteria[status]).toContain(
            "Content makes an actual assertion in the requested category",
        );
    expect(wikiCategorySupportCriteria.supported).not.toBe(
        wikiSupportCriteria.supported,
    );
    expect(wikiCategorySupportRules).not.toContain(
        "Known quantity/cohort/scope contradictions",
    );
    expect(wikiCategorySupportRules).not.toContain(
        "an identifiable supported-prior omission remains unsupported",
    );
    expect(partialSupportRules).toContain(wikiCategorySupportRules);
});

test("support policy is monotonic and independent of provider choice confidence", () => {
    const statuses: ViewSupportStatus[] = [
        "unsupported",
        "uncertain",
        "partiallySupported",
        "supported",
    ];
    const scores = statuses.map((status) =>
        supportQuality([
            { category: "newContentSupport", status, choiceConfidence: 1 },
        ]),
    );
    expect(scores.map((value) => value.confidence)).toEqual([0, 0.25, 0.5, 1]);
    for (let index = 1; index < scores.length; index++)
        expect(scores[index].confidence).toBeGreaterThan(
            scores[index - 1].confidence,
        );
    for (const status of statuses) {
        const score = (choiceConfidence: number) =>
            supportQuality([
                { category: "newContentSupport", status, choiceConfidence },
            ]).confidence;
        expect(score(0.1)).toBe(score(1));
    }
});

test("a later supported check never raises prior partial support quality", () => {
    const partial = supportQuality([
        { category: "newContentSupport", status: "partiallySupported" },
    ]);
    const supported = supportQuality([
        { category: "newContentSupport", status: "supported" },
    ]);
    expect(worstSupportQuality(partial, supported)).toEqual(partial);
    expect(worstSupportQuality(supported, partial)).toEqual(partial);
    expect(worstSupportQuality(undefined, undefined)).toBeUndefined();
});

test("partial and uncertain categories remain explicit; inapplicable checks do not lower support", () => {
    const quality = supportQuality([
        { category: "newContentSupport", status: "partiallySupported" },
        { category: "preservation", status: "uncertain" },
        { category: "quantity", status: "not_asserted" },
    ]);
    expect(quality.status).toBe("uncertain");
    expect(quality.unresolvedCategories).toEqual([
        "newContentSupport",
        "preservation",
    ]);
    expect(incompletePreservation(quality)).toBe(true);
    expect(
        incompletePreservation(
            supportQuality([
                { category: "newContentSupport", status: "supported" },
            ]),
        ),
    ).toBe(true);
    expect(
        supportQuality([{ category: "quantity", status: "not_asserted" }])
            .status,
    ).toBe("uncertain");
    expect(
        supportQuality([
            { category: "newContentSupport", status: "supported" },
            { category: "quantity", status: "not_asserted" },
        ]).confidence,
    ).toBe(1);
});

test("modern generative editorial schema preserves partial decisions and legacy checks remain unscored", () => {
    const schema = editorialAssessmentSchema().schema;
    expect(schema.required).toEqual(["safe", "failures"]);
    const checked = parseEditorialAssessment({
        safe: true,
        failures: [],
        decisions: [
            { category: "newContentSupport", status: "partiallySupported" },
        ],
    });
    expect(checked.quality).toMatchObject({
        status: "partiallySupported",
        confidence: 0.5,
        unresolvedCategories: ["newContentSupport"],
    });
    expect(() => assertEditorialAssessment(checked)).not.toThrow();
    expect(parseEditorialAssessment(checked)).toEqual(checked);
    expect(parseEditorialAssessment({ safe: true, failures: [] })).toEqual({
        safe: true,
        failures: [],
    });
    expect(
        parseEditorialAssessment({ safe: true, failures: [] }).quality,
    ).toBeUndefined();
});

test("contradictions remain unsafe even alongside useful partial support", () => {
    const checked = parseEditorialAssessment({
        safe: false,
        failures: ["quantity"],
        decisions: [
            { category: "newContentSupport", status: "partiallySupported" },
            { category: "quantity", status: "unsupported" },
        ],
    });
    expect(checked.quality?.confidence).toBe(0);
    expect(() => assertEditorialAssessment(checked)).toThrow(
        "critical-distinction",
    );
    expect(() =>
        parseEditorialAssessment({ ...checked, safe: true, failures: [] }),
    ).toThrow("invalid-assessment");
});

test("support metadata rejects forged scores, duplicate categories and invalid confidence", () => {
    const quality = supportQuality([
        { category: "newContentSupport", status: "partiallySupported" },
    ]);
    expect(() => parseSupportQuality({ ...quality, confidence: 1 })).toThrow(
        "Inconsistent support quality",
    );
    expect(() =>
        supportQuality([...quality.decisions, ...quality.decisions]),
    ).toThrow("Invalid support decisions");
    expect(() =>
        supportQuality([
            {
                category: "newContentSupport",
                status: "partiallySupported",
                choiceConfidence: Number.NaN,
            },
        ]),
    ).toThrow("Invalid support decisions");
});
