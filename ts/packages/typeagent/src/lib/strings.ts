// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Is x a prefix of y
export function stringPrefixCompare(x: string, y: string): number {
    // Find the length of the shorter string
    const length = Math.min(x.length, y.length);
    // Compare the substrings up to the length of the shorter string
    for (let i = 0; i < length; ++i) {
        if (x[i] < y[i]) {
            return -1;
        } else if (x[i] > y[i]) {
            return 1;
        }
    }

    // If all characters are equal up to the minLength, then check the lengths
    if (x.length < y.length) {
        return -1; // x is a prefix of y, since it is shorter
    } else if (x.length > y.length) {
        return 1; // yis a prefix of x
    }

    // Same chars, same length
    return 0;
}

export function lowerAndSort(values: string[] | undefined): void {
    if (values) {
        for (let i = 0; i < values.length; ++i) {
            values[i] = values[i].toLowerCase();
        }
        values.sort();    
    }
}