// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

function roundToInt(x: number): number {
    return Math.round(x);
}

export function func1(x: number, y: number, op: string): number {
    switch (op) {
        default:
            throw Error(`Unknown operator: ${op}`);
        case "+":
            return x + y;
        case "-":
            return x - y;
        case "*":
            return x * y;
        case "/":
            return x / y;
        case "^":
            return x ^ y;
        case "**":
            return Math.pow(x, y);
        case "%":
            return x % y;
        case "$$":
            return roundToInt(x) + func1(x, y, "*");
    }
}
