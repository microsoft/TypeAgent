// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOperatorList } from "../../src/converters/pdfToMarkdown/pdfjs5.js";

const codes = {
    constructPath: 91,
    moveTo: 13,
    lineTo: 14,
    curveTo: 15,
    closePath: 18,
    rectangle: 19,
    fill: 22,
    stroke: 20,
};

test("compact PDF.js 5 rectangles retain Papero's rectangle primitive", () => {
    const path = new Float32Array([
        0, 10, 20, 1, 110, 20, 1, 110, 21, 1, 10, 21, 3,
    ]);
    const result = normalizeOperatorList(
        { fnArray: [91], argsArray: [[22, [path], [10, 20, 110, 21]]] },
        codes,
    );
    assert.deepEqual(result.fnArray, [91, 22]);
    assert.deepEqual(result.argsArray, [[[19], [10, 20, 100, 1]], []]);
});

test("compact lines, curves, and closures preserve the upstream primitives", () => {
    const path = new Float32Array([0, 1, 2, 1, 3, 4, 2, 5, 6, 7, 8, 9, 10, 3]);
    const result = normalizeOperatorList(
        { fnArray: [91], argsArray: [[20, [path], [1, 2, 9, 10]]] },
        codes,
    );
    assert.deepEqual(result.fnArray, [91, 20]);
    assert.deepEqual(result.argsArray, [
        [
            [13, 14, 15, 18],
            [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        ],
        [],
    ]);
});

test("PDF.js 4 payloads and unrelated operations pass through", () => {
    const operators = {
        fnArray: [91, 20],
        argsArray: [
            [
                [13, 14],
                [0, 0, 1, 1],
            ],
            [],
        ],
        lastChunk: true,
    };
    assert.deepEqual(normalizeOperatorList(operators, codes), operators);
});

test("empty paint paths are normalized and unknown drawing codes fail explicitly", () => {
    assert.deepEqual(
        normalizeOperatorList(
            { fnArray: [91], argsArray: [[22, [null], null]] },
            codes,
        ).argsArray,
        [[[], []], []],
    );
    assert.throws(
        () =>
            normalizeOperatorList(
                { fnArray: [91], argsArray: [[20, [[99]], []]] },
                codes,
            ),
        /Unsupported PDF.js 5/,
    );
});
