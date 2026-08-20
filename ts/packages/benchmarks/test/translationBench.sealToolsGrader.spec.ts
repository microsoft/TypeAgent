// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { scoreSealToolsOfficial } from "../src/translationBench/public_datasets/Seal-Tools/eval/sealToolsGrader.js";

it("matches official Seal scoring for an extra predicted parameter", () => {
    const chosenActions = [
        {
            schemaName: "seal",
            actionName: "getCloudSlaInfo",
            parameters: {
                service_name: "AWS",
                region: "us-east-1",
                service_type: "compute",
            },
        },
        {
            schemaName: "seal",
            actionName: "backupData",
            parameters: { source_path: "/a", destination_path: "/b" },
        },
        {
            schemaName: "seal",
            actionName: "updateShipmentDetails",
            parameters: { shipment_id: "id", new_details: "details" },
        },
    ];
    const rows = [{ caseId: "case", chosenActions }];
    const gold = new Map([
        [
            "case",
            chosenActions.map((action) => ({
                api: action.actionName,
                parameters:
                    action.actionName === "getCloudSlaInfo"
                        ? { service_name: "AWS", service_type: "compute" }
                        : action.parameters!,
                responses: [],
            })),
        ],
    ]);

    const score = scoreSealToolsOfficial(rows, gold);
    expect(score).toMatchObject({
        formatAccuracy: 1,
        tool: { precision: 1, recall: 1, f1: 1 },
        parameter: { precision: 6 / 7, recall: 1 },
    });
    expect(score.parameter.f1).toBeCloseTo(12 / 13);
});

it("preserves official duplicate matching and zero-score omission", () => {
    const gold = new Map([
        ["case", [{ api: "lookup", parameters: { id: "1" }, responses: [] }]],
    ]);
    const duplicate = {
        schemaName: "seal",
        actionName: "lookup",
        parameters: { id: "1" },
    };
    const score = scoreSealToolsOfficial(
        [{ caseId: "case", chosenActions: [duplicate, duplicate] }],
        gold,
    );

    expect(score.tool).toEqual({ precision: 1, recall: 2, f1: 4 / 3 });
    expect(scoreSealToolsOfficial([], new Map())).toMatchObject({
        formatAccuracy: undefined,
        tool: { precision: undefined, recall: undefined, f1: undefined },
        parameter: {
            precision: undefined,
            recall: undefined,
            f1: undefined,
        },
    });
});

it("maps TypeAgent result references back to official API_call labels", () => {
    const rows = [
        {
            caseId: "nested",
            chosenActions: [
                {
                    schemaName: "seal",
                    actionName: "consume",
                    parameters: { location: "${step0.result}" },
                },
            ],
        },
    ];
    const gold = new Map([
        [
            "nested",
            [
                {
                    api: "produce",
                    parameters: {},
                    responses: ["API_call_0"],
                },
                {
                    api: "consume",
                    parameters: { location: "API_call_0" },
                    responses: [],
                },
            ],
        ],
    ]);
    const score = scoreSealToolsOfficial(rows, gold);
    const caseInsensitiveScore = scoreSealToolsOfficial(
        [
            {
                caseId: "nested",
                chosenActions: [
                    {
                        schemaName: "seal",
                        actionName: "CONSUME",
                        parameters: { LOCATION: "${step0.result}" },
                    },
                ],
            },
        ],
        gold,
        { ignoreStringCase: true },
    );

    expect(score.parameter).toEqual({ precision: 1, recall: 1, f1: 1 });
    expect(caseInsensitiveScore.parameter).toEqual({
        precision: 1,
        recall: 1,
        f1: 1,
    });
});

it("counts parameters only when the prediction value is an object", () => {
    const score = scoreSealToolsOfficial(
        [
            {
                caseId: "case",
                chosenActions: [
                    {
                        schemaName: "seal",
                        actionName: "lookup",
                        parameters: "not-a-dict" as never,
                    },
                ],
            },
        ],
        new Map([
            [
                "case",
                [{ api: "lookup", parameters: { id: "1" }, responses: [] }],
            ],
        ]),
    );

    expect(score.counts.predictedParameters).toBe(0);
    expect(score.parameter.f1).toBeUndefined();
});

it("matches the upstream aggregate counters across five mixed rows", () => {
    const action = (actionName: string, parameters: unknown) => ({
        schemaName: "seal",
        actionName,
        parameters: parameters as never,
    });
    const rows = [
        { caseId: "exact", chosenActions: [action("lookup", { id: "1" })] },
        {
            caseId: "extra",
            chosenActions: [
                action("lookup", { id: "2", region: "west" }),
                action("invented", { query: "x" }),
            ],
        },
        {
            caseId: "duplicate",
            chosenActions: [
                action("lookup", { id: "3" }),
                action("lookup", { id: "3" }),
            ],
        },
        { caseId: "not-dict", chosenActions: [action("lookup", "bad")] },
        { caseId: "format-error", chosenActions: [], error: "parse failed" },
    ];
    const gold = new Map(
        rows.map((row, index) => [
            row.caseId,
            [
                {
                    api: "lookup",
                    parameters: { id: String(index + 1) },
                    responses: [],
                },
            ],
        ]),
    );

    const score = scoreSealToolsOfficial(rows, gold);
    expect(score).toMatchObject({
        formatAccuracy: 4 / 5,
        tool: { precision: 5 / 6, recall: 1, f1: 10 / 11 },
        parameter: { precision: 2 / 3, recall: 4 / 5 },
        counts: {
            formatted: 4,
            rows: 5,
            correctTools: 5,
            predictedTools: 6,
            goldTools: 5,
            correctParameters: 4,
            predictedParameters: 6,
            goldParameters: 5,
        },
    });
    expect(score.parameter.f1).toBeCloseTo(8 / 11);
});

it("ignores case across API names, parameter names, and nested string values", () => {
    const score = scoreSealToolsOfficial(
        [
            {
                caseId: "case",
                chosenActions: [
                    {
                        schemaName: "seal",
                        actionName: "LOOKUP",
                        parameters: {
                            FILTER: { TAGS: ["RED", "Blue"] },
                        },
                    },
                ],
            },
        ],
        new Map([
            [
                "case",
                [
                    {
                        api: "lookup",
                        parameters: {
                            filter: { tags: ["red", "BLUE"] },
                        },
                        responses: [],
                    },
                ],
            ],
        ]),
        { ignoreStringCase: true },
    );

    expect(score.tool).toEqual({ precision: 1, recall: 1, f1: 1 });
    expect(score.parameter).toEqual({ precision: 1, recall: 1, f1: 1 });
});
