// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawnSync } from "node:child_process";
import path from "node:path";

import { scoreDroidCall } from "../src/translationBench/public_datasets/DroidCall/eval/droidCallGrader.js";
import { assertSuccessfulTrajectoryCoverage } from "../src/translationBench/public_datasets/DroidCall/eval/trajectoryJournal.js";

it("matches the released DroidCall contract", () => {
    const script = path.resolve(
        "src/translationBench/public_datasets/DroidCall/eval/officialDroidCallGrader.py",
    );
    const input = JSON.parse(
        `{"apis":[{"name":"pick","arguments":{"value":{"required":true,"match_type":"strict"},"tags":{"required":true,"match_type":"strict"},"hour":{"required":true,"match_type":"strict"},"optional":{"required":false,"default":false,"match_type":"strict"}}}],"rows":[{"answers":[{"id":0,"name":"pick","arguments":{"value":" Name ","tags":["A","B"],"hour":14}}],"response":[{"name":"pick","arguments":{"value":"name","tags":["b","a"],"hour":{"__pythonNumber":"14"}}}]}]}`,
    );
    const result = spawnSync("python3", [script], {
        input: JSON.stringify(input),
        encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
        softAccuracy: 1,
        accuracy: 1,
    });
});

it("scores ACTION_OPEN_DOCUMENT mime types by presence", () => {
    const script = path.resolve(
        "src/translationBench/public_datasets/DroidCall/eval/officialDroidCallGrader.py",
    );
    const api = {
        name: "ACTION_OPEN_DOCUMENT",
        arguments: {
            mime_types: { required: true, match_type: "strict" },
            allow_multiple: { required: false, default: false },
        },
    };
    const answer = {
        id: 0,
        name: api.name,
        arguments: { mime_types: ["application/pdf"], allow_multiple: true },
    };
    const input = {
        contract: "typeagent-adjusted",
        apis: [api],
        rows: [
            {
                answers: [answer],
                response: [
                    {
                        name: api.name,
                        arguments: {
                            mime_types: ["*/*"],
                            allow_multiple: true,
                        },
                    },
                ],
            },
            {
                answers: [answer],
                response: [
                    { name: api.name, arguments: { allow_multiple: true } },
                ],
            },
        ],
    };
    const result = spawnSync("python3", [script], {
        input: JSON.stringify(input),
        encoding: "utf8",
    });
    expect(JSON.parse(result.stdout)).toMatchObject({
        softAccuracy: 0.75,
        accuracy: 0.5,
        counts: { correctArguments: 3, totalArguments: 4 },
    });
});

it("keeps released and paper-described DroidCall contracts separate", () => {
    const script = path.resolve(
        "src/translationBench/public_datasets/DroidCall/eval/officialDroidCallGrader.py",
    );
    const payload = {
        apis: [
            {
                name: "wide",
                arguments: {
                    a: { required: true },
                    b: { required: true },
                    c: { required: true },
                },
            },
            { name: "narrow", arguments: { a: { required: true } } },
        ],
        rows: [
            {
                answers: [
                    { name: "wide", arguments: { a: 1, b: 2, c: 3 } },
                    { name: "narrow", arguments: { a: 1 } },
                ],
                response: [
                    { name: "wide", arguments: { a: 1, b: 2, c: 0 } },
                    { name: "narrow", arguments: { a: 1 } },
                ],
            },
        ],
    };
    const score = (contract: string) => {
        const result = spawnSync("python3", [script], {
            input: JSON.stringify({ ...payload, contract }),
            encoding: "utf8",
        });
        expect(result.status).toBe(0);
        return JSON.parse(result.stdout);
    };
    expect(score("released").softAccuracy).toBe(0.75);
    expect(score("paper-described").softAccuracy).toBeCloseTo(5 / 6);
});

it("scores a saved malformed response as a format failure", () => {
    const row = {
        caseId: "row-1",
        chosenActions: [],
    };
    const responses = new Map([[row.caseId, ["not json"]]]);
    expect(() =>
        assertSuccessfulTrajectoryCoverage([row], responses),
    ).not.toThrow();

    expect(
        scoreDroidCall(
            [row],
            new Map([
                [
                    row.caseId,
                    [{ id: 0, name: "pick", arguments: { value: "x" } }],
                ],
            ]),
            { rawResponsesByCase: responses },
        ),
    ).toMatchObject({
        formatAccuracy: 0,
        counts: { formatted: 0, rows: 1, goldTools: 1 },
    });
});
