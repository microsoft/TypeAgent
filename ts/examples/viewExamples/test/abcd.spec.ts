// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import {
    constructAbcdGuidelines,
    developmentCases,
    developmentFlows,
    exampleFlows,
    selectExampleSources,
    parsePrediction,
    scorePrediction,
} from "../src/abcd.js";

function documents() {
    const subflows = Object.fromEntries(
        developmentFlows.map((flow) => [
            flow.title,
            {
                instructions: [
                    "Choose any order. If nothing works, apologize and end.",
                ],
                actions: [
                    {
                        type: "faq policy",
                        button: "Try Again",
                        text: "Ask the fictional caller to try again.",
                        subtext: ["Do not assume success."],
                    },
                ],
            },
        ]),
    );
    return {
        guidelines: {
            "Troubleshoot Site": {
                description: "Fictional website troubleshooting",
                subflows,
            },
        },
        ontology: {
            actions: { faq_policy: { "try-again": [] } },
            values: { private: "never include" },
        },
    };
}

test("expanded guideline selection preserves category provenance, communication-only actions and overlapping source rules", () => {
    const selected = [
        "slow-speed",
        "search-not-working",
        "initiate-refund",
        "missing-item",
    ];
    const flows = exampleFlows.filter(({ id }) => selected.includes(id));
    const guidelines = Object.fromEntries(
        [...new Set(flows.map(({ category }) => category))].map((category) => [
            category,
            {
                description: `Source category ${category}`,
                subflows: Object.fromEntries(
                    flows
                        .filter((flow) => flow.category === category)
                        .map((flow) => [
                            flow.title,
                            {
                                instructions: [
                                    "Preserve source-defined conditions.",
                                ],
                                actions:
                                    flow.id === "missing-item"
                                        ? [
                                              {
                                                  type: "communication",
                                                  button: "N/A",
                                                  text: "7 days or less: explain the delivery delay.",
                                                  subtext: [],
                                              },
                                              {
                                                  type: "interaction",
                                                  button: "Update Order",
                                                  text: "A week or longer: arrange a replacement.",
                                                  subtext: [
                                                      "Enter the full address.",
                                                  ],
                                              },
                                          ]
                                        : [
                                              {
                                                  type: "interaction",
                                                  button:
                                                      flow.id ===
                                                      "initiate-refund"
                                                          ? "Offer Refund"
                                                          : "Try Again",
                                                  text: "Source instruction.",
                                                  subtext: [],
                                              },
                                          ],
                            },
                        ]),
                ),
            },
        ]),
    );
    const ontology = {
        actions: {
            interaction: {
                "offer-refund": ["amount"],
                "update-order": ["full_address"],
            },
            faq_policy: { "try-again": [] },
        },
    };
    const docs = constructAbcdGuidelines(guidelines, ontology, flows);
    expect(docs.map(({ id }) => id)).toEqual(selected);
    const missing = docs.find(({ id }) => id === "missing-item")!;
    expect(missing.text).toContain("7 days or less");
    expect(missing.text).toContain("A week or longer");
    expect(missing.text).toContain("N/A");
    expect(missing.allowedActions).toEqual(["update-order"]);
    expect(
        missing.mappings.some(({ upstreamPointer }) =>
            upstreamPointer.startsWith(
                "/Shipping Issue/subflows/Missing Item/",
            ),
        ),
    ).toBe(true);
    expect(
        docs.find(({ id }) => id === "initiate-refund")!.allowedActions,
    ).toEqual(["offer-refund"]);
    for (const doc of docs)
        for (const mapping of doc.mappings) {
            const source =
                mapping.upstreamFile === "guidelines.json"
                    ? guidelines
                    : ontology;
            const keys = mapping.upstreamPointer.slice(1).split("/");
            let value: unknown = source;
            for (const key of keys)
                value = (value as Record<string, unknown>)[key];
            const span = doc.text.slice(mapping.start, mapping.end);
            expect(createHash("sha256").update(span).digest("hex")).toBe(
                mapping.valueDigest,
            );
            expect(mapping.kind === "key" ? keys.at(-1) : value).toBe(span);
        }
    const bad = JSON.parse(JSON.stringify(guidelines));
    bad["Shipping Issue"].subflows["Missing Item"].actions[0].type =
        "interaction";
    expect(() => constructAbcdGuidelines(bad, ontology, flows)).toThrow(
        "Unmapped ABCD button: N/A",
    );
});

test("build-only source selection is ordered, bounded and separate from the frozen comparison slice", () => {
    const ids = [
        "slow-speed",
        "search-not-working",
        "initiate-refund",
        "missing-item",
    ];
    expect(selectExampleSources(undefined, ids, true)).toEqual(ids);
    expect(developmentFlows.map(({ id }) => id)).toEqual([
        "slow-speed",
        "shopping-cart",
    ]);
    expect(selectExampleSources(undefined, undefined, false)).toBeUndefined();
    expect(selectExampleSources("shopping-cart", undefined, true)).toEqual([
        "shopping-cart",
    ]);
    expect(() => selectExampleSources("shopping-cart", ids, true)).toThrow(
        "not both",
    );
    expect(() => selectExampleSources(undefined, ids, false)).toThrow(
        "buildOnly",
    );
    for (const invalid of [[], [""], ["unknown"], ["slow-speed", "slow-speed"]])
        expect(() => selectExampleSources(undefined, invalid, true)).toThrow();
});

test("construction retains every relevant source value, qualifiers and valid upstream span mappings, but no dialogue gold", () => {
    const { guidelines, ontology } = documents();
    const docs = constructAbcdGuidelines(guidelines, ontology);
    expect(docs).toHaveLength(2);
    for (const doc of docs) {
        expect(doc.text).toContain("Choose any order.");
        expect(doc.text).toContain("Do not assume success.");
        expect(doc.text).toContain("Fictional website troubleshooting");
        expect(doc.text).not.toContain("never include");
        for (const mapping of doc.mappings) {
            const span = doc.text.slice(mapping.start, mapping.end);
            expect(createHash("sha256").update(span).digest("hex")).toBe(
                mapping.valueDigest,
            );
            const source: unknown =
                mapping.upstreamFile === "guidelines.json"
                    ? guidelines
                    : ontology;
            let value: unknown = source;
            const parts = mapping.upstreamPointer.slice(1).split("/");
            for (const key of parts)
                value = (value as Record<string, unknown>)[key];
            if (mapping.kind === "value") expect(value).toBe(span);
            else expect(parts.at(-1)).toBe(span);
        }
    }
});

test("frozen dev selection never exceeds its cap or exposes target/future/scenario labels in the model packet", () => {
    const dev = developmentFlows.flatMap((flow) =>
        [1, 2].map((index) => ({
            convo_id: `${flow.id}-${index}`,
            scenario: { subflow: flow.subflow, private: "scenario-secret" },
            delexed: [
                {
                    speaker: "customer",
                    text: "observed prefix",
                    targets: [null, null, null, [], null],
                },
                {
                    speaker: "action",
                    text: "TARGET-TEXT",
                    targets: [
                        flow.subflow,
                        "take_action",
                        "try-again",
                        ["GOLD-VALUE"],
                        0,
                    ],
                },
                {
                    speaker: "customer",
                    text: "observed later",
                    targets: [null, null, null, [], null],
                },
                {
                    speaker: "action",
                    text: "FUTURE-TEXT",
                    targets: [flow.subflow, "take_action", "log-out-in", [], 0],
                },
            ],
        })),
    );
    const cases = developmentCases({ dev, test: "holdout excluded" });
    expect(cases).toHaveLength(4);
    for (const flow of developmentFlows)
        expect(cases.filter((item) => item.flowId === flow.id)).toHaveLength(2);
    for (const item of cases.filter(
        (item) => item.input.history.length === 1,
    )) {
        expect(JSON.stringify(item.input)).not.toMatch(
            /TARGET-TEXT|FUTURE-TEXT|GOLD-VALUE|scenario-secret|targets/,
        );
        expect(item.gold.values).toEqual(["GOLD-VALUE"]);
    }
    expect(() => developmentCases({ dev }, 0)).toThrow("between 1 and 20");
});

test("gold action agreement and source membership are separate; unordered alternatives are not labeled policy failure", () => {
    const gold = { nextstep: "take_action", action: "try-again", values: [] };
    const alternative = parsePrediction({
        nextstep: "take_action",
        action: "log-out-in",
        values: [],
    });
    expect(
        scorePrediction(gold, alternative, ["try-again", "log-out-in"]),
    ).toEqual({
        nextstep: true,
        action: false,
        values: true,
        sourceActionMembership: true,
    });
    expect(() =>
        parsePrediction({ ...gold, reasoning: "extra output" }),
    ).toThrow("shape");
    expect(
        scorePrediction(
            gold,
            { nextstep: "retrieve_utterance", action: null, values: [] },
            ["try-again"],
        ).sourceActionMembership,
    ).toBeNull();
    expect(
        scorePrediction(
            { ...gold, values: ["website team"] },
            { ...gold, values: ["manager"] },
            ["try-again"],
        ).values,
    ).toBe(false);
});

test("importing the live API is inert and unapproved programmatic work fails before configuration or filesystem access", async () => {
    const before = process.exitCode;
    const live = await import("../src/live.js");
    expect(process.exitCode).toBe(before);
    await expect(
        live.runApprovedPilot({
            outputDirectory: "not-created",
            datasetDirectory: "not-read",
            allowDownload: false,
            approvedModelWork: false,
        }),
    ).rejects.toThrow("explicit prior model-work approval");
});
