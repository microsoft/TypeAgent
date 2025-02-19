// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

let epoch: number = 0;

export function resetEpoch(): void {
    epoch = 0;
}

export function console_log(...rest: any[]): void {
    if (!epoch) {
        epoch = Date.now();
        console.log(""); // Start new epoch with a blank line
    }
    const t = Date.now();
    console.log(((t - epoch) / 1000).toFixed(3).padStart(6), ...rest);
}
