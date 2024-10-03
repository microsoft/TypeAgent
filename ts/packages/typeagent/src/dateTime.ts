// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomIntInRange } from "./lib/mathLib";

export type Timestamped<T = any> = {
    timestamp: Date;
    value: T;
};

export type DateRange = {
    startDate: Date;
    stopDate?: Date | undefined;
};

export function stringifyTimestamped(value: any, timestamp?: Date): string {
    timestamp ??= new Date();
    const timestamped = {
        timestamp: timestamp.toISOString(),
        value,
    };
    return JSON.stringify(timestamped);
}

export function parseTimestamped<T = any>(json: string): Timestamped<T> {
    const obj = JSON.parse(json);
    return {
        value: obj.value,
        timestamp: new Date(obj.timestamp),
    };
}

export function timestampString(date: Date, sep: boolean = true): string {
    const year = date.getFullYear().toString();
    const month = numberToString(date.getMonth() + 1, 2);
    const day = numberToString(date.getDate(), 2);
    const hour = numberToString(date.getHours(), 2);
    const minute = numberToString(date.getMinutes(), 2);
    const seconds = numberToString(date.getSeconds(), 2);
    const ms = numberToString(date.getMilliseconds(), 3);
    return sep
        ? `${year}_${month}_${day}_${hour}_${minute}_${seconds}_${ms}`
        : `${year}${month}${day}${hour}${minute}${seconds}${ms}`;
}

export function timestampStringUtc(date: Date, sep: boolean = true): string {
    const year = date.getUTCFullYear().toString();
    const month = numberToString(date.getUTCMonth() + 1, 2);
    const day = numberToString(date.getUTCDate(), 2);
    const hour = numberToString(date.getUTCHours(), 2);
    const minute = numberToString(date.getUTCMinutes(), 2);
    const seconds = numberToString(date.getUTCSeconds(), 2);
    const ms = numberToString(date.getUTCMilliseconds(), 3);
    return sep
        ? `${year}_${month}_${day}_${hour}_${minute}_${seconds}_${ms}`
        : `${year}${month}${day}${hour}${minute}${seconds}${ms}`;
}

function numberToString(value: number, length: number): string {
    return value.toString().padStart(length, "0");
}

export function* generateRandomDates(
    startDate: Date,
    minMsOffset: number,
    maxMsOffset: number,
): IterableIterator<Date> {
    let ticks = startDate.getTime();
    while (true) {
        const offset = randomIntInRange(minMsOffset, maxMsOffset);
        ticks += offset;
        yield new Date(ticks);
    }
}

export function stringToDate(value: string | undefined): Date | undefined {
    if (value) {
        try {
            return new Date(value);
        } catch {}
    }
    return undefined;
}
