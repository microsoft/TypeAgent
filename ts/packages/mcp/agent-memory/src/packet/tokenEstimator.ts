// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface TokenEstimator {
    estimate(text: string): number;
}

export class ConservativeTokenEstimator implements TokenEstimator {
    public estimate(text: string): number {
        if (text.length === 0) {
            return 0;
        }
        return Buffer.byteLength(text, "utf8");
    }
}
