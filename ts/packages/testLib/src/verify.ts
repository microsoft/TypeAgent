// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { Result } from "typechat";

export function verifyResult<T = any>(
    result: Result<T>,
    cb?: (data: T) => void,
): void {
    expect(result.success);
    if (result.success && cb) {
        cb(result.data);
    }
}

export function verifyString(str: string): void {
    expect(str).toBeDefined();
    expect(str.length).toBeGreaterThan(0);
}

export function verifyArray<T = any>(
    array: T[],
    canBeEmpty: boolean,
    cb?: (item: T) => void,
): void {
    expect(array).toBeDefined();
    if (!canBeEmpty) {
        expect(array.length).toBeGreaterThan(0);
    }
    for (const item of array) {
        expect(item).toBeDefined();
        if (cb) {
            cb(item);
        }
    }
}

export function verifyStringArray(array: string[], canBeEmpty: boolean): void {
    verifyArray(array, canBeEmpty, verifyString);
}
