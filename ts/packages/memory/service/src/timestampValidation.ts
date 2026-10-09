// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function validateIsoTimestamp(kind: string, value: string): void {
    const match =
        /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(
            value,
        );
    if (match === null || !Number.isFinite(Date.parse(value))) {
        throw new Error(`Invalid ${kind}; expected an ISO timestamp`);
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [
        31,
        leapYear ? 29 : 28,
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ][month - 1];
    if (days === undefined || day < 1 || day > days) {
        throw new Error(`Invalid ${kind}; expected an ISO timestamp`);
    }
}
